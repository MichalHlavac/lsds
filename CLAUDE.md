# CLAUDE.md — LSDS Agent Instructions

## Repozitář

Tento repozitář (`lsds`) je **veřejný**. Veškerý obsah commitovaný sem musí být vhodný pro veřejnost.

## Co patří SEM (do `lsds`)

- Zdrojový kód aplikace (`apps/`, `packages/`)
- Konfigurace buildu a CI (`package.json`, `.github/workflows/`)
- Veřejná dokumentace: setup guide, usage, API reference

## Co NEPATŘÍ sem

- Zadání, roadmapa, milníky, business requirements
- Interní architektonická rozhodnutí a design dokumenty
- Paperclip task ID v komentářích (`// PAP-123`)
- Jakýkoli soubor z `.claude/` nebo `CLAUDE.md` submodulů

## Kde žije dokumentace a zadání

Veškerá interní dokumentace, zadání a design dokumenty patří do soukromého repozitáře:
**`MichalHlavac/LSDS-research`**

## README pravidlo

`README.md` obsahuje pouze:
1. Co projekt je (1–2 věty)
2. Jak ho spustit / sestavit
3. Odkaz na licenci

Nikdy: zadání, roadmapa, interní kontext, Paperclip tasky.

