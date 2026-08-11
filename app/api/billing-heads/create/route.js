import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import BillingHead from '@/models/BillingHead';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';
import { UNIT_CLASS_VALUES } from '@/lib/commercial/constants';
import { normalizeUnitClassRates } from '@/lib/commercial/billingApplicability';
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.head.create");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    const {
      headName,
      calculationType,
      defaultAmount,
      appliesToUnitClasses,
      unitClassRates,
    } = await request.json();
    // Optional per-class rate override. Absent = every class pays
    // defaultAmount, exactly as today.
    const rates = normalizeUnitClassRates(unitClassRates);
    // Optional and additive: an absent or empty list means "applies to every
    // unit", which is exactly how every existing head already behaves.
    let unitClasses;
    if (Array.isArray(appliesToUnitClasses) && appliesToUnitClasses.length > 0) {
      if (!appliesToUnitClasses.every((c) => UNIT_CLASS_VALUES.includes(c))) {
        return NextResponse.json({ error: 'Invalid unit class' }, { status: 400 });
      }
      unitClasses = [...new Set(appliesToUnitClasses)];
    }
    if (!headName || !calculationType || defaultAmount === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    // Check duplicate
    const existing = await BillingHead.findOne({
      societyId: decoded.societyId,
      headName: headName.trim(),
      isDeleted: false
    });
    if (existing) {
      return NextResponse.json({ error: 'Billing head already exists' }, { status: 409 });
    }
    // Get max order
    const maxOrder = await BillingHead.findOne({ societyId: decoded.societyId })
      .sort({ order: -1 })
      .select('order')
      .lean();
    const billingHead = await BillingHead.create({
      headName: headName.trim(),
      calculationType,
      defaultAmount: parseFloat(defaultAmount),
      order: maxOrder ? maxOrder.order + 1 : 0,
      societyId: decoded.societyId,
      isActive: true,
      ...(unitClasses ? { appliesToUnitClasses: unitClasses } : {}),
      ...(rates ? { unitClassRates: rates } : {})
    });
    console.log('✅ Created billing head:', billingHead.headName);
    return NextResponse.json({
      success: true,
      head: billingHead
    }, { status: 201 });
  } catch (error) {
    console.error('❌ Create billing head error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}