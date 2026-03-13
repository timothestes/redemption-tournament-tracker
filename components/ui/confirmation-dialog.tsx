"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "./dialog";
import { cn } from "@/lib/utils";

const variants = {
  destructive: {
    headerBg: "bg-red-50 dark:bg-red-900/20",
    headerBorder: "border-red-200 dark:border-red-800",
    iconBg: "bg-red-100 dark:bg-red-900/40",
    iconColor: "text-red-600 dark:text-red-400",
    buttonBg: "bg-red-600 hover:bg-red-700",
  },
  warning: {
    headerBg: "bg-orange-50 dark:bg-orange-900/20",
    headerBorder: "border-orange-200 dark:border-orange-800",
    iconBg: "bg-orange-100 dark:bg-orange-900/40",
    iconColor: "text-orange-600 dark:text-orange-400",
    buttonBg: "bg-orange-600 hover:bg-orange-700",
  },
} as const;

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  variant?: keyof typeof variants;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

const WarningIcon = () => (
  <svg
    className="w-6 h-6"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

export default function ConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  variant = "destructive",
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  icon,
  children,
}: ConfirmationDialogProps) {
  const v = variants[variant];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader className={cn(v.headerBg, v.headerBorder)}>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                v.iconBg,
                v.iconColor
              )}
            >
              {icon ?? <WarningIcon />}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {title}
              </h3>
              {description && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {description}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        {children && <DialogBody>{children}</DialogBody>}

        <DialogFooter className="justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className={cn(
              "px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors",
              v.buttonBg
            )}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
