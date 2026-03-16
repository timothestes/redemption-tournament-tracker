"use client";

import { useState, useCallback } from "react";

export default function ShareButton({ cardName }: { cardName: string }) {
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined" ? window.location.href : "";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [url]);

  const handleShare = useCallback(() => {
    if (navigator.share) {
      navigator.share({ title: cardName, url }).catch(() => {});
    } else {
      handleCopy();
    }
  }, [cardName, url, handleCopy]);

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-3"
      >
        {copied ? (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Copy link
          </>
        )}
      </button>
      <button
        onClick={handleShare}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-3"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        Share
      </button>
    </div>
  );
}
