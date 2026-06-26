"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import { promosForYear } from "@/lib/nationals/promos";

interface PromoCardsModalProps {
  year: number;
  open: boolean;
  onClose: () => void;
}

export function PromoCardsModal({ year, open, onClose }: PromoCardsModalProps) {
  const promos = promosForYear(year);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{year} Nationals Promo Cards</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {promos.map((promo) => {
              const imgUrl = getCardImageUrl(promo.imgFile);
              return (
                <div key={`${promo.label}-${promo.imgFile}`} className="flex flex-col items-center text-center gap-1.5">
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt={promo.cardName}
                      className="w-full h-auto rounded-md shadow-md border border-border"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] flex items-center justify-center rounded-md border border-border bg-muted text-muted-foreground text-xs px-2">
                      {promo.cardName}
                    </div>
                  )}
                  <p className="text-xs font-semibold text-foreground leading-tight">{promo.cardName}</p>
                  <p className="text-xs text-muted-foreground italic">{promo.label}</p>
                </div>
              );
            })}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
