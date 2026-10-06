"use client";
import { useEffect, useRef, useState } from 'react';
import type { LensGraph } from '@/lib/graph';
import type { InputDraft } from '@/lib/review-workbench';
import { readScreenLocation, resolveScreenLocation, shouldPushScreenHistory, screenURL, type ScreenLocation } from '@/lib/navigation';

export function useScreenNavigation(args: {
  ready: boolean; projectId: string; graph: LensGraph; drafts: Record<string, InputDraft>; selectedId: string;
  location: ScreenLocation; onOpen: (location: ScreenLocation, selectedId: string) => void;
}) {
  const latest = useRef(args); latest.current = args;
  const [ready, setReady] = useState(false), [version, setVersion] = useState(0);
  const [notice, setNotice] = useState(''), [link, setLink] = useState('');
  const replaceNext = useRef(true);
  useEffect(() => {
    if (!args.ready) return;
    const open = () => {
      const current = latest.current, parsed = readScreenLocation(window.location.search);
      // A different project needs its own snapshot and browser drafts before any view can mount.
      if (parsed.location.projectId !== current.projectId) { window.location.reload(); return; }
      const resolved = resolveScreenLocation(parsed.location, current.graph, current.drafts, current.selectedId);
      replaceNext.current = true;
      current.onOpen(resolved.location, resolved.selectedId);
      setNotice(resolved.notice || parsed.notice);
      setVersion(v => v + 1); setReady(true);
    };
    open();
    window.addEventListener('popstate', open);
    return () => window.removeEventListener('popstate', open);
  }, [args.ready, args.projectId]);

  const signature = JSON.stringify(args.location);
  useEffect(() => {
    if (!ready) return;
    const frame = window.requestAnimationFrame(() => {
      const location = latest.current.location;
      const target = screenURL(window.location.href, location), actual = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const previous = readScreenLocation(window.location.search).location;
      if (target !== actual) {
        const method = !replaceNext.current && shouldPushScreenHistory(previous, location) ? 'pushState' : 'replaceState';
        window.history[method](window.history.state, '', target);
      }
      replaceNext.current = false;
      setLink(new URL(target, window.location.href).href);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready, signature, version]);
  return { ready, version, notice, link, getLink: () => new URL(screenURL(window.location.href, latest.current.location), window.location.href).href, clearNotice: () => setNotice('') };
}
