#!/usr/bin/env bash
# axe-core sweep over the screens available to the logged-in role, in both themes.
set -u
AXE='https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
for theme in dark light; do
  for path in "$@"; do
    chrome-devtools-axi open "http://localhost:8080$path" >/dev/null 2>&1
    chrome-devtools-axi wait 2200 >/dev/null 2>&1
    chrome-devtools-axi eval "() => { try { localStorage.setItem('mui-mode','$theme') } catch (e) {}; document.documentElement.setAttribute('data-mui-color-scheme','$theme'); return '$theme' }" >/dev/null 2>&1
    chrome-devtools-axi wait 600 >/dev/null 2>&1
    out=$(chrome-devtools-axi eval "() => new Promise((resolve) => { if (window.axe) return resolve('ok'); const s=document.createElement('script'); s.src='$AXE'; s.onload=()=>resolve('ok'); s.onerror=()=>resolve('err'); document.head.appendChild(s) }).then(() => axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).then(r => JSON.stringify(r.violations.map(v => v.id + ' x' + v.nodes.length + ' [' + v.impact + '] ' + v.nodes[0].html.slice(0,90))))" 2>&1 | head -2)
    echo "$theme $path -> $out"
  done
done
