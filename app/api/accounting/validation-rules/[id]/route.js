import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  updateValidationRule,
  deleteValidationRule,
  ValidationRuleServiceError,
} from "@/lib/services/ValidationRuleService";

// PATCH /api/accounting/validation-rules/:id — Admin/Secretary only.
export async function PATCH(request, { params }) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const patch = await request.json();
    const rule = await updateValidationRule(auth.user.societyId, id, patch);
    return NextResponse.json({ validationRule: rule });
  } catch (error) {
    if (error instanceof ValidationRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Update validation rule error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// DELETE /api/accounting/validation-rules/:id — Admin/Secretary only (soft delete).
export async function DELETE(request, { params }) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const result = await deleteValidationRule(auth.user.societyId, id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ValidationRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Delete validation rule error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
