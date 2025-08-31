import React, { useState } from 'react';
import Image from 'next/image';
import { useCardImageUrl } from '../hooks/useCardImageUrl';

interface CardImageProps {
  imgFile: string; // Changed from src to imgFile
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  onClick?: () => void;
}

export default function CardImage({ imgFile, alt, className = "", sizes, priority = false, onClick }: CardImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const { getImageUrl } = useCardImageUrl();
  
  const src = getImageUrl(imgFile);

  return (
    <div className="relative w-full aspect-[2.5/3.5] bg-transparent rounded overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800 animate-pulse">
          <div className="text-gray-400 text-xs">Loading...</div>
        </div>
      )}
      
      {hasError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-400 text-xs p-2">
          <div>🃏</div>
          <div className="text-center mt-1">Image not found</div>
        </div>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          className={`object-contain transition-opacity duration-200 ${isLoading ? 'opacity-0' : 'opacity-100'} ${className}`}
          sizes={sizes}
          priority={priority}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
          onClick={onClick}
          unoptimized={src.startsWith('/api/')} // Don't double-optimize proxy images
        />
      )}
    </div>
  );
}
