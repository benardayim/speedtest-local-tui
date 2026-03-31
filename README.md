# speedtest-local-tui

zero-dependency LAN speedtest for node.js as a single script.

## what is it?
a zero dependency, single-script speedtest tool with TUI. it automatically detects other instances in LAN, also supports remote IP addresses with manual adding. it can do tests of upload, download and duplex (both).

## why?
i wanted to check if my CAT cables were correctly labeled and if my switch was working well, so i made this. i hope it will be useful for others too.

## quick start (no installation)

if you have node.js installed, you can execute the repo directly.

```bash
npx github:benardayim/speedtest-local-tui
```

### alternative start (with downloading)

either clone that repo then run start

```bash
git clone https://github.com/benardayim/speedtest-local-tui.git
cd speedtest-local-tui
npm start
```

or just download it and run directly.

```bash
curl -O https://raw.githubusercontent.com/benardayim/speedtest-local-tui/refs/heads/main/speedtest-local-tui.mjs
node speedtest-local-tui.mjs
```

## how it works
it listens for both tcp and udp. it frequently sends direct broadcast so other instances in the LAN can find each other. it just sends or receives random bytes with selected instance.

## license
this project is open-source and available under the [MIT License](LICENSE).