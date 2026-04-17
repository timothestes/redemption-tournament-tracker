'use client';

// Prevent "Do not know how to serialize a BigInt" errors —
// SpacetimeDB uses BigInt extensively and Next.js chokes when
// JSON.stringify encounters one during its build/render analysis.
if (typeof BigInt !== 'undefined' && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

import { SpacetimeDBProvider as Provider } from 'spacetimedb/react';
import type { ReactNode } from 'react';
import type { DbConnectionBuilder } from '@/lib/spacetimedb/module_bindings';

interface Props {
  connectionBuilder: DbConnectionBuilder;
  children: ReactNode;
}

export function SpacetimeProvider({ connectionBuilder, children }: Props) {
  return (
    <Provider connectionBuilder={connectionBuilder}>
      {children}
    </Provider>
  );
}
