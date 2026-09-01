"use client";
/**
 * Page 4 of the 6-page accounting environment: Cash Flow Setup.
 * What counts as cash-in-hand vs bank, and reconciling each bank account
 * against its statement — the same BankAccountsPage that used to be a tab
 * on Registers, now its own page per the revamp spec.
 */
import { PageHeader, Icon } from "@/components/revamp";
import BankAccountsPage from "../bank-accounts/PageClient";

export default function CashFlowPageClient() {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="banknote" size={11} /> Liquidity</>}
        title="Cash Flow Setup"
        sub="What counts as cash-in-hand vs bank, and reconciling each account against its statement — the split the Balance Sheet and cash reports use."
      />
      <BankAccountsPage />
    </div>
  );
}
