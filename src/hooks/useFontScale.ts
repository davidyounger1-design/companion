import { useState } from 'react'
import { getStoredFontScale, setStoredFontScale } from '../lib/fontScale'

export function useFontScale() {
  const [scale, setScale] = useState(getStoredFontScale)

  function updateScale(next: number) {
    setScale(setStoredFontScale(next))
  }

  return { scale, setScale: updateScale }
}
