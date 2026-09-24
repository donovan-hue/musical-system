import { useSyncExternalStore } from 'react'
import { store } from './store'
import type { AppState } from './types'

export function useAppSelector<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}
