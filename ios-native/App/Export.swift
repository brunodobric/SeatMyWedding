import SwiftUI
import UIKit
import UniformTypeIdentifiers
import CoreTransferable
import SeatingCore

/// Datoteke za dijeljenje i ispis (CSV, JSON, PDF) u privremenoj mapi.
enum ExportFiles {
    static func write(_ name: String, _ data: Data) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("izvoz", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try data.write(to: url, options: .atomic)
        return url
    }

    static func csv(_ wedding: WeddingData) throws -> URL {
        try write("raspored-sjedenja.csv", Data(wedding.csv().utf8))
    }

    static func json(_ wedding: WeddingData) throws -> URL {
        try write("raspored-sjedenja.json", Data(wedding.backupJSONString().utf8))
    }

    static func pdf(_ wedding: WeddingData, tables: Bool, alphabetical: Bool) throws -> URL {
        try write("raspored-sjedenja.pdf", SeatingPDF.render(wedding, tables: tables, alphabetical: alphabetical))
    }
}

/// PDF za ispis: stranice "Raspored sjedenja" (po stolovima) i "Gdje sjedim" (abecedno).
enum SeatingPDF {
    private static let page = CGRect(x: 0, y: 0, width: 595, height: 842)
    private static let margin: CGFloat = 48

    static func render(_ wedding: WeddingData, tables: Bool, alphabetical: Bool) -> Data {
        let title = wedding.settings.string("weddingTitle").flatMap { $0.isEmpty ? nil : $0 } ?? "Moje Vjenčanje"
        let monogram = wedding.settings.string("monogram").flatMap { $0.isEmpty ? nil : $0 } ?? "♡"
        let renderer = UIGraphicsPDFRenderer(bounds: page)
        return renderer.pdfData { ctx in
            if tables { drawTables(ctx, wedding.printTables(), title: title, monogram: monogram) }
            if alphabetical { drawAlphabetical(ctx, wedding.printAlphabetical(), title: title, monogram: monogram) }
        }
    }

    private static let ink = UIColor(red: 0.17, green: 0.15, blue: 0.13, alpha: 1)
    private static let gold = UIColor(red: 0.63, green: 0.49, blue: 0.20, alpha: 1)

    private static func draw(_ text: String, at point: CGPoint, font: UIFont, color: UIColor = ink,
                             width: CGFloat? = nil, align: NSTextAlignment = .left) -> CGFloat {
        let style = NSMutableParagraphStyle()
        style.alignment = align
        style.lineBreakMode = .byTruncatingTail
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: style]
        let w = width ?? (page.width - margin - point.x)
        let size = (text as NSString).boundingRect(
            with: CGSize(width: w, height: .greatestFiniteMagnitude), options: .usesLineFragmentOrigin,
            attributes: attrs, context: nil).size
        (text as NSString).draw(in: CGRect(x: point.x, y: point.y, width: w, height: ceil(size.height)), withAttributes: attrs)
        return ceil(size.height)
    }

    private static func header(_ subtitle: String, title: String, monogram: String) -> CGFloat {
        var y = margin
        y += draw(monogram, at: CGPoint(x: margin, y: y), font: .systemFont(ofSize: 28, weight: .light),
                  color: gold, width: page.width - 2 * margin, align: .center) + 4
        y += draw(title, at: CGPoint(x: margin, y: y), font: .systemFont(ofSize: 22, weight: .semibold),
                  width: page.width - 2 * margin, align: .center) + 2
        y += draw(subtitle, at: CGPoint(x: margin, y: y), font: .systemFont(ofSize: 13),
                  color: gold, width: page.width - 2 * margin, align: .center) + 22
        return y
    }

    private static func drawTables(_ ctx: UIGraphicsPDFRendererContext, _ tables: [PrintTable], title: String, monogram: String) {
        ctx.beginPage()
        let y = header("Raspored sjedenja", title: title, monogram: monogram)
        let gap: CGFloat = 24
        let colWidth = (page.width - 2 * margin - gap) / 2
        var col = 0
        var rowTop = y
        var rowBottom = y
        for (i, t) in tables.enumerated() {
            let height = 20 + CGFloat(max(1, t.guests.count)) * 16 + 14
            if col == 0, rowBottom + height > page.height - margin {
                ctx.beginPage()
                rowTop = margin; rowBottom = margin
            }
            if col == 1, rowTop + height > page.height - margin {
                ctx.beginPage()
                rowTop = margin; rowBottom = margin; col = 0
            }
            let x = margin + CGFloat(col) * (colWidth + gap)
            var ty = rowTop
            ty += draw(t.name, at: CGPoint(x: x, y: ty), font: .systemFont(ofSize: 14, weight: .semibold),
                       color: gold, width: colWidth) + 6
            if t.guests.isEmpty {
                ty += draw("—", at: CGPoint(x: x, y: ty), font: .systemFont(ofSize: 12), width: colWidth) + 4
            }
            for (n, g) in t.guests.enumerated() {
                ty += draw("\(n + 1). \(g)", at: CGPoint(x: x, y: ty), font: .systemFont(ofSize: 12), width: colWidth) + 4
            }
            ty += 14
            rowBottom = max(rowBottom, ty)
            if col == 0 {
                col = 1
            } else {
                col = 0
                rowTop = rowBottom
            }
            _ = i
        }
    }

    private static func drawAlphabetical(_ ctx: UIGraphicsPDFRendererContext, _ rows: [PrintRow], title: String, monogram: String) {
        ctx.beginPage()
        var y = header("Gdje sjedim", title: title, monogram: monogram)
        for r in rows {
            if y + 20 > page.height - margin {
                ctx.beginPage()
                y = margin
            }
            let nameWidth = page.width - 2 * margin - 140
            let h = draw(r.name, at: CGPoint(x: margin, y: y), font: .systemFont(ofSize: 13), width: nameWidth)
            _ = draw(r.table, at: CGPoint(x: page.width - margin - 130, y: y), font: .systemFont(ofSize: 13, weight: .semibold),
                     width: 130, align: .right)
            y += h + 8
        }
    }
}

/// Datoteke se prave tek kad korisnik odabere dijeljenje (ne pri svakom crtanju).
struct PDFExport: Transferable {
    let wedding: WeddingData
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .pdf) { doc in
            SentTransferredFile(try ExportFiles.pdf(doc.wedding, tables: true, alphabetical: true))
        }
    }
}

struct CSVExport: Transferable {
    let wedding: WeddingData
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { doc in
            SentTransferredFile(try ExportFiles.csv(doc.wedding))
        }
    }
}

struct JSONExport: Transferable {
    let wedding: WeddingData
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .json) { doc in
            SentTransferredFile(try ExportFiles.json(doc.wedding))
        }
    }
}

/// Izbornik za izvoz, dijeljenje i ispis rasporeda.
struct ExportMenu: View {
    @Environment(WeddingStore.self) private var store

    var body: some View {
        let wedding = store.data
        Menu {
            if let text = wedding.seatingShareText() {
                ShareLink(item: text, subject: Text("Gdje sjedim")) {
                    Label("Podijeli popis (tekst)", systemImage: "text.bubble")
                }
            }
            ShareLink(item: PDFExport(wedding: wedding), preview: SharePreview("Raspored sjedenja.pdf")) {
                Label("Ispis / PDF rasporeda", systemImage: "printer")
            }
            ShareLink(item: CSVExport(wedding: wedding), preview: SharePreview("raspored-sjedenja.csv")) {
                Label("Izvoz CSV (Excel)", systemImage: "tablecells")
            }
            ShareLink(item: JSONExport(wedding: wedding), preview: SharePreview("raspored-sjedenja.json")) {
                Label("Sigurnosna kopija (JSON)", systemImage: "externaldrive")
            }
        } label: {
            Image(systemName: "square.and.arrow.up")
        }
        .disabled(store.guests.isEmpty)
    }
}
