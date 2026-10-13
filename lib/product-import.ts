import { strToU8, unzipSync, zipSync } from "fflate";

// Product import files (Excel .xlsx, CSV, JSON) are read into raw records keyed
// by canonical field names. Validation of the values happens in the caller.

export type ImportField = "name" | "category" | "retail_price" | "wholesale_price" | "cost_price" | "stock" | "barcode" | "image_icon";
export type RawProductRecord = Partial<Record<ImportField, string>> & { sourceRow: number };

export const importColumns: { field: ImportField; header: string; required: boolean; note: string }[] = [
  { field: "name", header: "Product Name", required: true, note: "Unique name. A name that already exists updates that product." },
  { field: "category", header: "Category", required: true, note: "Existing or new category; new names create a category." },
  { field: "retail_price", header: "Retail Price", required: true, note: "Selling price in ₱, above 0." },
  { field: "wholesale_price", header: "Wholesale Price", required: false, note: "Optional ₱ price in wholesale mode. Leave blank for products not sold wholesale (like single sachets); for an existing product, blank keeps its current value and 0 removes it." },
  { field: "cost_price", header: "Cost Price", required: false, note: "₱ cost used for profit reports. Blank keeps it unset." },
  { field: "stock", header: "Stock", required: true, note: "Whole number of units on hand." },
  { field: "barcode", header: "Barcode", required: false, note: "Optional. Keep the column formatted as Text so leading zeros stay." },
];

// Header spellings people commonly use, compared after lowercasing and
// removing everything except letters and digits.
const headerAliases: Record<string, ImportField> = {
  name: "name", productname: "name", product: "name", item: "name", itemname: "name", description: "name",
  category: "category", categories: "category", type: "category",
  retailprice: "retail_price", price: "retail_price", srp: "retail_price", sellingprice: "retail_price", retail: "retail_price",
  wholesaleprice: "wholesale_price", wholesale: "wholesale_price",
  costprice: "cost_price", cost: "cost_price", unitcost: "cost_price", purchaseprice: "cost_price",
  stock: "stock", stocks: "stock", quantity: "stock", qty: "stock", onhand: "stock", inventory: "stock",
  barcode: "barcode", barcodenumber: "barcode", upc: "barcode", ean: "barcode",
  imageicon: "image_icon", icon: "image_icon",
};

const numericFields = new Set<ImportField>(["retail_price", "wholesale_price", "cost_price", "stock"]);

const normalizeHeader = (header: string) => header.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// "₱1,250.00", "PHP 25", " 12 " → plain numeric text; other text is left for
// validation to reject.
// Accepts the ways spreadsheets show amounts: "₱1,250.00", "PHP 25", "P25".
// Excel's Accounting format shows zero as a dash ("₱ -"), and a CSV saved
// from Excel keeps that text, so a lone dash means 0. "N/A" or "none" means
// blank (no value).
function cleanNumber(value: string) {
  const cleaned = value.replace(/₱|php/gi, "").replace(/^p(?=\s*[\d.\-–—])/i, "").replace(/,/g, "").trim();
  if (/^[-–—]+$/.test(cleaned)) return "0";
  if (/^(n\/?a|none|nil)$/i.test(cleaned)) return "";
  return cleaned;
}

// Turns a header row plus data rows into records. Rows that are completely
// empty are skipped; sourceRow is the 1-based row number in the file.
export function rowsToRecords(rows: string[][]): RawProductRecord[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim()));
  if (headerIndex === -1) throw new Error("The file is empty.");
  const fields = rows[headerIndex].map((header) => headerAliases[normalizeHeader(header)]);
  const missing = importColumns.filter((column) => column.required && !fields.includes(column.field));
  if (missing.length) {
    throw new Error(`Missing column${missing.length === 1 ? "" : "s"}: ${missing.map((column) => column.header).join(", ")}. Download the template to see the expected headers.`);
  }
  const records: RawProductRecord[] = [];
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => cell.trim())) return;
    const record: RawProductRecord = { sourceRow: headerIndex + offset + 2 };
    fields.forEach((field, column) => {
      if (!field || record[field] !== undefined) return;
      const value = (row[column] ?? "").trim();
      record[field] = numericFields.has(field) ? cleanNumber(value) : value;
    });
    records.push(record);
  });
  if (!records.length) throw new Error("The file has headers but no product rows.");
  return records;
}

export function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"' && quoted && content[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("The CSV file has an unclosed quoted field.");
  row.push(cell);
  rows.push(row);
  return rows;
}

export function jsonToRecords(content: string): RawProductRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("The selected JSON file is not valid JSON.");
  }
  if (!Array.isArray(value)) throw new Error("Product JSON must be an array of product records.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Product ${index + 1} in the JSON file must be an object.`);
    const record: RawProductRecord = { sourceRow: index + 1 };
    for (const [key, raw] of Object.entries(item as Record<string, unknown>)) {
      const field = headerAliases[normalizeHeader(key)];
      if (!field || raw === null || raw === undefined || record[field] !== undefined) continue;
      const text = String(raw).trim();
      record[field] = numericFields.has(field) ? cleanNumber(text) : text;
    }
    return record;
  });
}

// ---------- Excel (.xlsx) ----------

const xmlOf = (files: Record<string, Uint8Array>, path: string) => {
  const data = files[path];
  if (!data) return null;
  const document = new DOMParser().parseFromString(new TextDecoder().decode(data), "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("The Excel file contains invalid XML.");
  return document;
};
const byLocalName = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS("*", name));
const textOf = (node: Element) => byLocalName(node, "t").map((part) => part.textContent ?? "").join("");

function columnIndex(reference: string) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? "";
  return letters.split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

// Reads the first worksheet of an .xlsx file into rows of display text.
export function readXlsxRows(buffer: ArrayBuffer): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("This doesn’t look like an Excel .xlsx file. In Excel, use File → Save As → Excel Workbook (.xlsx).");
  }
  const workbook = xmlOf(files, "xl/workbook.xml");
  const relations = xmlOf(files, "xl/_rels/workbook.xml.rels");
  if (!workbook || !relations) throw new Error("This Excel file has no workbook. Save it as an Excel Workbook (.xlsx) and try again.");

  const firstSheet = byLocalName(workbook, "sheet")[0];
  const relationId = firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? firstSheet?.getAttribute("r:id");
  const target = byLocalName(relations, "Relationship").find((relation) => relation.getAttribute("Id") === relationId)?.getAttribute("Target");
  if (!target) throw new Error("The Excel file has no worksheets.");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = xmlOf(files, sheetPath);
  if (!sheet) throw new Error("The first worksheet could not be read.");

  const sharedStringsDocument = xmlOf(files, "xl/sharedStrings.xml");
  // Rich-text runs are joined; phonetic hints (rPh) are not part of the text.
  const sharedStrings = sharedStringsDocument
    ? byLocalName(sharedStringsDocument, "si").map((item) => {
      byLocalName(item, "rPh").forEach((hint) => hint.remove());
      return textOf(item);
    })
    : [];

  const rows: string[][] = [];
  for (const rowElement of byLocalName(sheet, "row")) {
    const rowNumber = Number(rowElement.getAttribute("r")) || rows.length + 1;
    const cells: string[] = [];
    byLocalName(rowElement, "c").forEach((cell, position) => {
      const reference = cell.getAttribute("r");
      const column = reference ? columnIndex(reference) : position;
      const type = cell.getAttribute("t");
      const raw = byLocalName(cell, "v")[0]?.textContent ?? "";
      let value: string;
      if (type === "s") value = sharedStrings[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textOf(cell);
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (type === "e") value = "";
      else value = raw;
      cells[column] = value;
    });
    rows[rowNumber - 1] = Array.from(cells, (value) => value ?? "");
  }
  return Array.from(rows, (row) => row ?? []);
}

// ---------- Writing .xlsx (template and export) ----------

type Cell = string | number | null;
type SheetSpec = { name: string; rows: Cell[][]; widths: number[]; textColumns?: number[] };

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const columnLetter = (index: number) => {
  let letters = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  return letters;
};

// Style ids from styles.xml below: 0 default, 1 bold header, 2 Text (for
// barcodes), 3 ₱ number with 2 decimals.
function sheetXml({ rows, widths, textColumns = [] }: SheetSpec, moneyColumns: number[]) {
  const cols = widths.map((width, index) => {
    const style = textColumns.includes(index) ? ' style="2"' : "";
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"${style}/>`;
  }).join("");
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, column) => {
    if (value === null || value === "") return "";
    const reference = `${columnLetter(column)}${rowIndex + 1}`;
    if (rowIndex === 0) return `<c r="${reference}" t="inlineStr" s="1"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
    if (typeof value === "number") return `<c r="${reference}"${moneyColumns.includes(column) ? ' s="3"' : ""}><v>${value}</v></c>`;
    return `<c r="${reference}" t="inlineStr"${textColumns.includes(column) ? ' s="2"' : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

function buildWorkbook(sheets: SheetSpec[], moneyColumnsBySheet: number[][]) {
  const sheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const sheetEntries = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const sheetRelations = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRelations}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = sheetXml(sheet, moneyColumnsBySheet[index] ?? []); });
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])));
}

const productColumnWidths = importColumns.map((column) => (column.field === "name" ? 32 : column.field === "barcode" ? 18 : 16));
const barcodeColumn = importColumns.findIndex((column) => column.field === "barcode");
const moneyColumns = importColumns.flatMap((column, index) => (column.field.endsWith("_price") ? [index] : []));

const guideSheet: SheetSpec = {
  name: "Guide",
  rows: [
    ["Column", "Required", "What to enter"],
    ...importColumns.map((column) => [column.header, column.required ? "Yes" : "No", column.note]),
    ["", "", ""],
    ["Tip", "", "Fill in the Products sheet only. Column order doesn’t matter, and extra columns are ignored."],
  ],
  widths: [18, 10, 80],
};

// products-template.xlsx: a "Products" sheet with just the headers (the sheet
// that is imported) and a "Guide" sheet describing each column.
export function buildTemplateXlsx() {
  return buildWorkbook([
    { name: "Products", rows: [importColumns.map((column) => column.header)], widths: productColumnWidths, textColumns: [barcodeColumn] },
    guideSheet,
  ], [moneyColumns]);
}

export type ExportProduct = {
  name: string;
  category: string;
  price: number;
  wholesalePrice: number;
  costPrice: number;
  costPriceKnown: boolean;
  stock: number;
  barcode: string | null;
};

// Inventory export in the import layout, so the file can be edited and
// imported again. An unset cost price is left blank (blank keeps it unset).
export function buildProductsXlsx(products: ExportProduct[]) {
  const valueFor = (product: ExportProduct, field: ImportField): Cell => {
    switch (field) {
      case "name": return product.name;
      case "category": return product.category;
      case "retail_price": return product.price;
      case "wholesale_price": return product.wholesalePrice > 0 ? product.wholesalePrice : null; // blank = retail only
      case "cost_price": return product.costPriceKnown ? product.costPrice : null;
      case "stock": return product.stock;
      case "barcode": return product.barcode;
      default: return null;
    }
  };
  return buildWorkbook([
    {
      name: "Products",
      rows: [importColumns.map((column) => column.header), ...products.map((product) => importColumns.map((column) => valueFor(product, column.field)))],
      widths: productColumnWidths,
      textColumns: [barcodeColumn],
    },
    guideSheet,
  ], [moneyColumns]);
}

// Reads any supported import file into raw records.
export async function readProductFile(file: File): Promise<RawProductRecord[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return rowsToRecords(readXlsxRows(await file.arrayBuffer()));
  if (name.endsWith(".xls")) throw new Error("Older .xls files aren’t supported. In Excel, use File → Save As → Excel Workbook (.xlsx).");
  if (name.endsWith(".json")) return jsonToRecords(await file.text());
  if (name.endsWith(".csv") || file.type === "text/csv") return rowsToRecords(parseCsvRows(await file.text()));
  throw new Error("Choose an Excel (.xlsx), CSV, or JSON file.");
}
