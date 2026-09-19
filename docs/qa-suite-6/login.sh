#!/bin/bash
# QA6: log in through the real form and land on the dashboard.
set -e
U="$1"; P="${2:-QA6-Testowe-Haslo!}"
SNAP=$(chrome-devtools-axi snapshot 2>&1)
L=$(echo "$SNAP" | grep -oP 'uid=\K\S+(?= textbox "Login")')
chrome-devtools-axi fill "@$L" "$U" >/dev/null 2>&1 || true
SNAP=$(chrome-devtools-axi snapshot 2>&1)
H=$(echo "$SNAP" | grep -oP 'uid=\K\S+(?= textbox "Hasło")')
chrome-devtools-axi fill "@$H" "$P" >/dev/null 2>&1 || true
SNAP=$(chrome-devtools-axi snapshot 2>&1)
B=$(echo "$SNAP" | grep -oP 'uid=\K\S+(?= button "Zaloguj")')
chrome-devtools-axi click "@$B" 2>&1 | head -3
