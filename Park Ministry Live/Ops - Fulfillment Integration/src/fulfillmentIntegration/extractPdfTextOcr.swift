import Foundation
import PDFKit
import Vision
import CoreGraphics

struct PageOCRResult: Codable {
    let page_number: Int
    let text: String
}

struct OCRPayload: Codable {
    let ok: Bool
    let path: String
    let page_count: Int
    let text: String
    let pages: [PageOCRResult]
    let source: String
}

struct ErrorPayload: Codable {
    let ok: Bool
    let error: String
    let message: String
    let path: String
}

func renderPageToImage(_ page: PDFPage, scale: CGFloat = 4.0) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let width = max(Int(bounds.width * scale), 1)
    let height = max(Int(bounds.height * scale), 1)
    let colorSpace = CGColorSpaceCreateDeviceRGB()

    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return nil
    }

    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.saveGState()
    context.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()

    return context.makeImage()
}

func recognizeText(from image: CGImage) throws -> String {
    let semaphore = DispatchSemaphore(value: 0)
    var recognizedText = ""
    var requestError: Error?

    let request = VNRecognizeTextRequest { request, error in
        defer { semaphore.signal() }

        if let error = error {
            requestError = error
            return
        }

        let observations = request.results as? [VNRecognizedTextObservation] ?? []
        recognizedText = observations
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    DispatchQueue.global(qos: .userInitiated).async {
        do {
            try handler.perform([request])
        } catch {
            requestError = error
            semaphore.signal()
        }
    }

    semaphore.wait()

    if let error = requestError {
        throw error
    }

    return recognizedText
}

func encodeAndPrint<T: Encodable>(_ payload: T) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(payload),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    }
}

let arguments = CommandLine.arguments

guard arguments.count > 1 else {
    encodeAndPrint(
        ErrorPayload(
            ok: false,
            error: "missing_pdf_path",
            message: "Missing PDF path argument.",
            path: ""
        )
    )
    exit(1)
}

let pdfPath = arguments[1]
let pdfURL = URL(fileURLWithPath: pdfPath)

guard let document = PDFDocument(url: pdfURL) else {
    encodeAndPrint(
        ErrorPayload(
            ok: false,
            error: "pdf_open_failed",
            message: "Unable to open PDF document.",
            path: pdfPath
        )
    )
    exit(1)
}

var pages: [PageOCRResult] = []

do {
    for index in 0 ..< document.pageCount {
        guard let page = document.page(at: index) else {
            continue
        }

        guard let image = renderPageToImage(page) else {
            continue
        }

        let text = try recognizeText(from: image)
        pages.append(PageOCRResult(page_number: index + 1, text: text))
    }

    let fullText = pages.map(\.text).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    encodeAndPrint(
        OCRPayload(
            ok: true,
            path: pdfPath,
            page_count: pages.count,
            text: fullText,
            pages: pages,
            source: "ocr_vision"
        )
    )
} catch {
    encodeAndPrint(
        ErrorPayload(
            ok: false,
            error: "ocr_failed",
            message: error.localizedDescription,
            path: pdfPath
        )
    )
    exit(1)
}
