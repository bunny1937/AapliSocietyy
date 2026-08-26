"use client";
import { toast } from "sonner";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmDialogHost";

// Drop-in replacement for window.alert() / window.confirm() / window.prompt(),
// themed to match the app (see ToastProvider.js + ConfirmDialogHost.js).
//   alert("x")            -> notify.info("x")            (or .success/.error/.warning)
//   confirm("x")           -> await notify.confirm("x")   (same true/false return)
//   prompt("x", "default") -> await notify.prompt("x", "default") (same string/null return)
const notify = {
  success: (message, opts) => toast.success(message, opts),
  error: (message, opts) => toast.error(message, opts),
  warning: (message, opts) => toast.warning(message, opts),
  info: (message, opts) => toast.message(message, opts),

  confirm: (message, opts = {}) =>
    confirmDialog({
      title: opts.title ?? "Are you sure?",
      message: typeof message === "string" ? message : "",
      tone: opts.tone ?? "danger",
      confirmLabel: opts.confirmLabel ?? "Confirm",
      cancelLabel: opts.cancelLabel ?? "Cancel",
    }),

  prompt: (message, defaultValue = "", opts = {}) =>
    promptDialog({
      title: opts.title ?? (typeof message === "string" ? message : "Enter a value"),
      message: opts.message ?? "",
      defaultValue,
      tone: opts.tone ?? "info",
      confirmLabel: opts.confirmLabel ?? "OK",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      inputType: opts.inputType ?? "text",
    }),
};

export default notify;
