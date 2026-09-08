import { create } from 'zustand'
export interface Notice { message: string; session: number; undo?: () => Promise<void> }
export const useNotification = create<{ notice: Notice | null }>(() => ({ notice: null }))
export function notify(notice: Notice) { useNotification.setState({ notice }) }
