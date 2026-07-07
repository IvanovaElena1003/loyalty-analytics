export const MODE = (import.meta.env.VITE_MODE as string) || 'full'
export const isFullMode = MODE === 'full'
export const isLimitedMode = MODE === 'limited'
