'use client';

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
