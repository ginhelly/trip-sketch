// Типы пакета browser-geo-tz указывают на его исходники (src/find.ts),
// которые не проходят строгую проверку. tsconfig.app.json подменяет их
// этим файлом, где описано только то, что используется в проекте.
export function find(lat: number, lon: number): Promise<string[]>
