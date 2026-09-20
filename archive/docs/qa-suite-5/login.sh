#!/usr/bin/env bash
# Log the browser session in as the given user through the real form.
set -u
user="$1"; pass="${2:-OncallQA-2026!}"
field() { chrome-devtools-axi snapshot | grep -oP "uid=\S+(?= textbox \"$1\")" | head -1 | cut -d= -f2; }
chrome-devtools-axi open "http://localhost:8080/" >/dev/null 2>&1
chrome-devtools-axi wait 1200 >/dev/null 2>&1
chrome-devtools-axi eval '() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Wyloguj"); if (b) b.click(); return "ok" }' >/dev/null 2>&1
chrome-devtools-axi wait 1000 >/dev/null 2>&1
chrome-devtools-axi fill "@$(field Login)" "$user" >/dev/null 2>&1
chrome-devtools-axi fill "@$(field Hasło)" "$pass" >/dev/null 2>&1
chrome-devtools-axi eval '() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Zaloguj"); b.click(); return "ok" }' >/dev/null 2>&1
chrome-devtools-axi wait 2500 >/dev/null 2>&1
chrome-devtools-axi eval '() => { const h=document.querySelector("header"); return h ? h.innerText.replace(/\n/g," | ") : "NIEZALOGOWANY" }'
