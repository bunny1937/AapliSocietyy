// lib/commercial/shopOwnerInvite.js
//
// The owner-invite logic, lifted out of app/api/commercial/shops/[id]/invite/route.js
// so that SAVING a shop can perform it directly. Admins were expected to save
// the shop and then find a second button; in practice the shop got saved and
// the owner was never invited, which is exactly how a shop ends up linked to a
// member with no Commercial profile and no email.
//
// The decisions are unchanged from the reviewed flow:
//   RESIDENT      owner keeps their login and gains a Commercial profile
//   EXISTING USER same, for a non-resident who already has an account
//   NEW ACCOUNT   non-resident gets a login + credential-setup email
//   AMBIGUOUS     email already used by an account -> the admin must choose
//
// What differs is only HOW the ambiguous case is reported. When called from a
// save (`auto: true`) it must never throw, because the shop has already been
// written and failing the request would make the admin think the save was
// lost. It returns { needsChoice, candidates } and the caller surfaces it.

import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { CommercialError, notFound } from "@/lib/commercial/errors";
import User from "@/models/User";
import Shop from "@/models/Shop";
import Society from "@/models/Society";
import { buildUsernameBloomFilter, generateSimpleUsername } from "@/lib/username-generator";
import { generatePassword } from "@/lib/password-generator";
import { signToken } from "@/lib/jwt";
import { sendEmail, onboardingEmailHtml } from "@/lib/brevo-email";
import { sendInApp } from "@/lib/visitor-channels";

export function commercialProfile({ societyId, shop, societyName, isPrimary }) {
  return {
    profileId: new mongoose.Types.ObjectId(),
    societyId,
    kind: "Commercial",
    shopId: shop._id,
    societyName: societyName ?? "",
    isPrimary,
    status: "Active",
  };
}

/**
 * Adds the Commercial profile for this shop if it is not already present.
 * Returns true when a profile was actually added.
 */
export async function attachCommercialProfile(owner, { societyId, shop, societyName }) {
  const already = (owner.profiles || []).some((p) => String(p.shopId) === String(shop._id));
  if (already) return false;
  owner.profiles.push(
    commercialProfile({
      societyId,
      shop,
      societyName,
      isPrimary: (owner.profiles || []).length === 0,
    }),
  );
  // validateModifiedOnly: save() validates the WHOLE document. A legacy sibling
  // profile written before the current ProfileSchema (e.g. one missing
  // societyId) would otherwise throw a ValidationError and abort an invite that
  // has nothing wrong with it.
  await owner.save({ validateModifiedOnly: true });
  return true;
}

export function shopAddedEmailHtml({ ownerName, societyName, unitLabel, loginUrl }) {
  // Deliberately NOT onboardingEmailHtml: that template's whole call to action
  // is "set your username and password", which this recipient already has.
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
      <p>Hello ${ownerName || "there"},</p>
      <p>
        <strong>${unitLabel}</strong> at <strong>${societyName || "your society"}</strong>
        has been linked to your existing account.
      </p>
      <p>
        You do <strong>not</strong> need to create a new login. Sign in with the account you
        already use, and choose the <strong>Shop</strong> profile when the app asks which
        profile you want to open. You can switch between your home and your shop at any time
        from the profile switcher.
      </p>
      <p><a href="${loginUrl}" style="color:#1a56db">Sign in</a></p>
      <p style="color:#666;font-size:12px">
        If you did not expect this, contact your society office.
      </p>
    </div>
  `;
}

/**
 * Gets a shop owner onto the platform.
 *
 * @param shop       hydrated Shop document (already saved)
 * @param societyId  tenant scope from the caller's token, never the body
 * @param userId     the admin performing this, for the in-app notice
 * @param linkUserId admin's explicit choice of an existing account
 * @param createNew  admin's explicit choice to make a separate account
 * @param auto       true when called from a save: report, never throw
 */
export async function inviteShopOwner({
  shop,
  societyId,
  userId,
  linkUserId = null,
  createNew = false,
  auto = false,
}) {
  if (!shop.ownerEmail) {
    if (auto) return { invited: false, skipped: "NO_OWNER_EMAIL" };
    throw new CommercialError(
      400,
      "Add an owner email to this shop before inviting.",
      "NO_OWNER_EMAIL",
    );
  }

  // models/Society.js declares the field as `name`. Selecting `societyName`
  // returned undefined, so every invite email said "your society".
  const society = await Society.findById(societyId).select("societyCode name address").lean();
  const societyName = society?.name ?? "";
  const unitLabel =
    [shop.wing, shop.shopNo].filter(Boolean).join("-") +
    (shop.tradeName ? ` (${shop.tradeName})` : "");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  let targetUser;
  let path;
  let attached = false;

  if (shop.ownerMemberId) {
    // ---- Resident owner ----------------------------------------------------
    // Shop.js's pre-save hook forbids ownerMemberId and ownerUserId together,
    // so this shop's link is already established and must NOT be touched.
    // memberId and societyId must match inside the SAME profile element.
    const owner = await User.findOne({
      profiles: { $elemMatch: { memberId: shop.ownerMemberId, societyId } },
    });
    if (!owner) {
      if (auto) return { invited: false, skipped: "OWNER_MEMBER_NOT_FOUND" };
      throw new CommercialError(
        404,
        "This shop's owner is linked to a resident member, but no matching login account was found. Check the member record.",
        "OWNER_MEMBER_NOT_FOUND",
      );
    }
    attached = await attachCommercialProfile(owner, { societyId, shop, societyName });
    targetUser = owner;
    path = "RESIDENT";
  } else if (shop.ownerUserId) {
    // ---- Owner already has an account --------------------------------------
    const owner = await User.findById(shop.ownerUserId);
    if (!owner) {
      if (auto) return { invited: false, skipped: "OWNER_USER_NOT_FOUND" };
      throw notFound();
    }
    attached = await attachCommercialProfile(owner, { societyId, shop, societyName });
    targetUser = owner;
    path = "EXISTING_OWNER_USER";
  } else {
    // ---- Non-resident owner, first invitation ------------------------------
    // Never auto-link on email alone. Email is not unique on User, so matching
    // on it could attach a stranger's shop to someone else's login, and not
    // checking it silently created duplicate accounts. The admin decides.
    const candidates = await User.find({
      email: shop.ownerEmail,
      isActive: { $ne: false },
    })
      .select("username email name profiles mustChangePassword")
      .limit(10)
      .lean();

    const shaped = candidates.map((c) => ({
      userId: String(c._id),
      username: c.username,
      email: c.email ?? null,
      name: c.name ?? null,
      isActivated: c.mustChangePassword !== true,
      profileCount: (c.profiles || []).length,
    }));

    if (candidates.length && !linkUserId && !createNew) {
      if (auto) return { invited: false, needsChoice: true, candidates: shaped };
      throw new CommercialError(
        409,
        {
          error:
            "An account already uses this email address. Choose whether to link this shop to that account or create a separate one.",
          code: "OWNER_ACCOUNT_CHOICE_REQUIRED",
          candidates: shaped,
        },
        "OWNER_ACCOUNT_CHOICE_REQUIRED",
      );
    }

    if (linkUserId) {
      // Only an account the admin was actually shown may be linked, so a
      // hand-crafted linkUserId cannot attach an arbitrary user's login here.
      const chosen = candidates.find((c) => String(c._id) === linkUserId);
      if (!chosen) {
        throw new CommercialError(
          400,
          "That account cannot be linked to this shop. Reload the shop and try again.",
          "INVALID_LINK_TARGET",
        );
      }
      const owner = await User.findById(chosen._id);
      if (!owner) throw notFound();
      attached = await attachCommercialProfile(owner, { societyId, shop, societyName });
      shop.ownerUserId = owner._id;
      await shop.save();
      targetUser = owner;
      path = "LINKED_EXISTING_ACCOUNT";
    } else {
      const bloom = await buildUsernameBloomFilter();
      const username = await generateSimpleUsername(
        society?.societyCode || "soc",
        `shop-${shop.shopNo}`,
        bloom,
      );
      const tempPassword = generatePassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const [newUser] = await User.create([
        {
          name: shop.ownerName,
          email: shop.ownerEmail,
          username,
          phone: shop.ownerPhone || null,
          password: passwordHash,
          role: "Member",
          societyId,
          mustChangePassword: true,
          isActive: true,
          profiles: [commercialProfile({ societyId, shop, societyName, isPrimary: true })],
        },
      ]);
      shop.ownerUserId = newUser._id;
      await shop.save();
      targetUser = newUser;
      attached = true;
      path = "NEW_ACCOUNT";
    }
  }

  // Record that this owner now has access, so the admin list can show
  // "already invited" without re-deriving it from User on every row. Written
  // regardless of which branch above resolved targetUser (all four mean the
  // owner can now reach this shop from the app).
  if (
    shop.ownerAccess?.granted !== true ||
    String(shop.ownerAccess.userId) !== String(targetUser._id)
  ) {
    shop.ownerAccess = {
      granted: true,
      userId: targetUser._id,
      path,
      grantedAt: new Date(),
    };
    await shop.save();
  }

  // ---- Notify --------------------------------------------------------------
  // An activated account must not be sent a credential-setup link, because
  // /api/onboarding/set-credentials refuses it. Decide by the same flag that
  // endpoint checks.
  const needsCredentials = targetUser.mustChangePassword === true;
  let emailSent = false;
  let emailError = null;

  // The Commercial profile is already saved by this point. sendEmail throws on
  // any non-2xx from Brevo, so an unset BREVO_API_KEY used to turn a COMPLETED
  // link into a 500 the admin reads as "nothing happened".
  const trySend = async (payload) => {
    try {
      await sendEmail(payload);
      return true;
    } catch (e) {
      emailError = e?.message || "Email could not be sent.";
      return false;
    }
  };

  if (needsCredentials) {
    const onboardingToken = signToken(
      { userId: String(targetUser._id), purpose: "onboarding" },
      { expiresIn: "7d" },
    );
    const setCredentialsUrl = `${appUrl}/onboarding/set-credentials?token=${onboardingToken}`;
    emailSent = await trySend({
      to: shop.ownerEmail,
      subject: `Set up your account \u2014 ${societyName || "your society"}`,
      html: onboardingEmailHtml({
        memberName: shop.ownerName,
        societyName,
        societyAddress: society?.address ?? "",
        unitKind: shop.unitKind || "Shop",
        unitLabel,
        setCredentialsUrl,
      }),
    });
  } else {
    emailSent = await trySend({
      to: shop.ownerEmail,
      subject: `${shop.tradeName || shop.unitKind || "Your shop"} was added to your account`,
      html: shopAddedEmailHtml({
        ownerName: shop.ownerName,
        societyName,
        unitLabel,
        loginUrl: `${appUrl}/login`,
      }),
    });
    // In-app as well as email: the person already uses this app, so the app is
    // the surface they will actually see. A notification failure must never
    // fail the invite.
    await sendInApp({
      societyId,
      createdBy: userId,
      createdByName: "Society office",
      type: "SHOP_PROFILE_ADDED",
      title: "Shop added to your account",
      message: `${unitLabel} is now available on your account. Switch to the Shop profile to open it.`,
      recipientType: "user",
      recipientIds: [String(targetUser._id)],
      actionUrl: "/shop",
      metadata: { shopId: String(shop._id) },
    }).catch(() => null);
  }

  return {
    invited: true,
    alreadyAttached: !attached,
    userId: String(targetUser._id),
    path,
    credentialsEmailSent: needsCredentials && emailSent,
    shopAddedNoticeSent: !needsCredentials && emailSent,
    emailError,
  };
}

/**
 * Called straight after a shop is created or edited: saving IS the invite.
 *
 * Never throws. A shop that saved correctly must not report failure because a
 * mail server was down or because the owner's email is ambiguous — the admin
 * would reasonably assume the save itself was lost. Every outcome comes back as
 * a sentence to show them instead.
 *
 * @returns { invite, note } — note already includes `savedNote`.
 */
export async function autoInviteAfterSave({ shopId, societyId, userId, savedNote = "" }) {
  const say = (extra) => [savedNote, extra].filter(Boolean).join(" ");

  let shop;
  try {
    shop = await Shop.findOne({ _id: shopId, societyId, isDeleted: { $ne: true } });
  } catch {
    return { invite: null, note: savedNote };
  }
  if (!shop) return { invite: null, note: savedNote };

  let invite;
  try {
    invite = await inviteShopOwner({ shop, societyId, userId, auto: true });
  } catch (e) {
    // Belt and braces: inviteShopOwner already reports rather than throws in
    // auto mode, but a genuine infrastructure error must not undo the save.
    return {
      invite: { invited: false, error: e?.message || "The owner could not be invited." },
      note: say("The shop was saved, but the owner could not be invited. Open the shop and use 'Invite the owner'."),
    };
  }

  if (invite.needsChoice) {
    return {
      invite,
      note: say(
        "An account already uses that email address, so no invite was sent yet. Open this shop and choose whether to link that account or create a separate one.",
      ),
    };
  }

  if (!invite.invited) {
    const why = {
      NO_OWNER_EMAIL: "No invite was sent because this shop has no owner email.",
      OWNER_MEMBER_NOT_FOUND:
        "No invite was sent: that member has no login account yet. Onboard the member first.",
      OWNER_USER_NOT_FOUND: "No invite was sent: the linked owner account no longer exists.",
    };
    return { invite, note: say(why[invite.skipped] || "No invite was sent.") };
  }

  if (invite.alreadyAttached) {
    return { invite, note: say("The owner already had this shop on their account.") };
  }

  if (invite.emailError) {
    return {
      invite,
      note: say(
        `The shop was added to the owner's account, but the email could not be delivered (${invite.emailError}).`,
      ),
    };
  }

  if (invite.credentialsEmailSent) {
    return {
      invite,
      note: say("An account was created for the owner and the setup email has been sent."),
    };
  }

  return {
    invite,
    note: say(
      "The owner has been emailed and can now switch to the Shop profile in the app.",
    ),
  };
}
