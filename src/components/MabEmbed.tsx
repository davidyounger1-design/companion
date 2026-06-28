import { useEffect, useRef } from 'react'

// Renders a MyAppBuddy embed custom element (e.g. myappbuddy-support) without
// letting React touch its properties.
//
// React 19 assigns a JSX/createElement prop as an element *property* when a
// matching property exists on the custom element instance. The embed elements
// expose a getter-only `accent`, so `el.accent = …` throws
// ("Cannot set property accent ... which has only a getter"), which unmounts
// the React tree and blanks the page. We build the element ourselves and use
// setAttribute (what the widgets actually read), which also ensures every
// attribute is present before connectedCallback runs.
export function MabEmbed({ tag, attrs }: { tag: string; attrs: Record<string, string> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const serialized = JSON.stringify(attrs)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) el.setAttribute(k, v)
    }
    el.style.display = 'block'
    host.appendChild(el)
    return () => { el.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, serialized])

  return <div ref={hostRef} />
}
