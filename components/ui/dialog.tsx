"use client";

import React, { useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Dialog (root overlay)                                              */
/* ------------------------------------------------------------------ */

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  // ESC key dismissal
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogContent (the modal box — stops propagation)                  */
/* ------------------------------------------------------------------ */

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
}

function DialogContent({
  size = "sm",
  className,
  children,
  ...props
}: DialogContentProps) {
  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
  };

  return (
    <div
      className={cn(
        "bg-[hsl(var(--dialog-bg))] border border-[hsl(var(--dialog-border))] rounded-lg shadow-xl ring-1 ring-black/5 dark:ring-white/5 w-full mx-4 overflow-hidden",
        sizeClasses[size],
        className
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogHeader                                                       */
/* ------------------------------------------------------------------ */

function DialogHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-[hsl(var(--dialog-header-bg))] border-b border-[hsl(var(--dialog-border))] px-6 py-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogTitle                                                        */
/* ------------------------------------------------------------------ */

function DialogTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-lg font-semibold text-foreground", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogDescription                                                  */
/* ------------------------------------------------------------------ */

function DialogDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-muted-foreground mt-1", className)}
      {...props}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogBody                                                         */
/* ------------------------------------------------------------------ */

function DialogBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-6 py-4", className)} {...props}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogFooter                                                       */
/* ------------------------------------------------------------------ */

function DialogFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-t border-[hsl(var(--dialog-border))] px-6 py-4 flex gap-3",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
};
