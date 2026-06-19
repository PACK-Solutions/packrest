"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Form-shaped Dialog used in place of `window.prompt`. Keeps a single
// instance mounted per host page; render with `open=true` then call
// `onSubmit(value)` from the controlled parent. Closing via Escape /
// overlay / X all route through `onCancel`.
//
// One or two fields: the second is optional (`field2Label`). Used by:
//   • RequestBuilder.handleSave (request name + collection name)
//   • CollectionsPage.onRename (single field)

interface Props {
  open: boolean;
  title: string;
  description?: string;
  field1Label: string;
  field1DefaultValue?: string;
  field1Placeholder?: string;
  field2Label?: string;
  field2DefaultValue?: string;
  field2Placeholder?: string;
  submitLabel?: string;
  onSubmit: (value1: string, value2: string) => void;
  onCancel: () => void;
}

export default function PromptDialog({
  open,
  title,
  description,
  field1Label,
  field1DefaultValue = "",
  field1Placeholder,
  field2Label,
  field2DefaultValue = "",
  field2Placeholder,
  submitLabel = "Valider",
  onSubmit,
  onCancel,
}: Props) {
  const [v1, setV1] = useState(field1DefaultValue);
  const [v2, setV2] = useState(field2DefaultValue);
  useEffect(() => {
    if (open) {
      setV1(field1DefaultValue);
      setV2(field2DefaultValue);
    }
  }, [open, field1DefaultValue, field2DefaultValue]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = v1.trim();
            if (!trimmed) return;
            onSubmit(trimmed, v2.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <div className="space-y-1">
              <label
                htmlFor="prompt-field-1"
                className="text-foreground text-xs font-semibold"
              >
                {field1Label}
              </label>
              <Input
                id="prompt-field-1"
                autoFocus
                value={v1}
                onChange={(e) => setV1(e.target.value)}
                placeholder={field1Placeholder}
              />
            </div>
            {field2Label && (
              <div className="space-y-1">
                <label
                  htmlFor="prompt-field-2"
                  className="text-foreground text-xs font-semibold"
                >
                  {field2Label}
                </label>
                <Input
                  id="prompt-field-2"
                  value={v2}
                  onChange={(e) => setV2(e.target.value)}
                  placeholder={field2Placeholder}
                />
              </div>
            )}
          </div>
          <DialogFooter className="mt-5">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!v1.trim()}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
