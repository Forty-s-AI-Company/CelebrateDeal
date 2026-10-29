"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useConfirmDialog } from "@/components/confirm-action-button";

type FormSubmitButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & {
  children: ReactNode;
  pendingChildren: ReactNode;
  pendingMessage: string;
  pendingOverride?: boolean;
  confirmMessage?: string;
  /** Red confirm button in the in-page confirmation (use for destructive actions). */
  confirmDestructive?: boolean;
  className?: string;
};

/**
 * 讓所有 Server Action 表單在送出期間提供一致、可存取的回饋，並避免重複送出。
 */
export function FormSubmitButton({
  children,
  pendingChildren,
  pendingMessage,
  pendingOverride = false,
  confirmMessage,
  confirmDestructive = false,
  className,
  disabled = false,
  type = "submit",
  onClick,
  name,
  value,
  formAction,
  ...buttonProps
}: FormSubmitButtonProps) {
  const { pending, data, action } = useFormStatus();
  const { confirm, dialog } = useConfirmDialog();
  const hasSubmitterName = typeof name === "string" && name.length > 0;
  const submittedByName = hasSubmitterName && data
    ? data.getAll(name).some((submittedValue) => (
        typeof submittedValue === "string" && submittedValue === String(value ?? "")
      ))
    : null;
  const submittedByAction = !hasSubmitterName && formAction && action
    ? formAction === action
    : null;
  const isActivePending = (pending || pendingOverride) && (submittedByName ?? submittedByAction ?? true);
  const isDisabled = pending || pendingOverride || disabled;

  return (
    <>
      <button
        {...buttonProps}
        type={type}
        name={name}
        value={value}
        formAction={formAction}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={isActivePending}
        onClick={(event) => {
          const button = event.currentTarget;
          const form = button.form;
          const formIsValid = form?.checkValidity() ?? true;
          const requiresConfirmation = Boolean(confirmMessage) && (button.formNoValidate || formIsValid);
          if (!requiresConfirmation) { onClick?.(event); return; }

          // Ask inside the page (a native confirm() would freeze browser
          // automation). `onClick` runs only after the user confirms, then the
          // same button is submitted so its name, value and formAction stay
          // intact. Cancelling does nothing at all.
          event.preventDefault();
          confirm({ message: confirmMessage!, destructive: confirmDestructive }, () => {
            onClick?.(event);
            if (type === "submit" && form) form.requestSubmit(button);
          }, button);
        }}
        className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {isActivePending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span
              aria-hidden="true"
              data-loading-indicator="true"
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
            />
            {pendingChildren}
          </span>
        ) : children}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {isActivePending ? pendingMessage : ""}
      </span>
      {dialog}
    </>
  );
}
