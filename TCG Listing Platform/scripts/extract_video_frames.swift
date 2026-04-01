import Foundation
import AVFoundation
import CoreMedia
import AppKit

struct Output: Encodable {
    let durationSeconds: Double
    let intervalSeconds: Double
    let frames: [String]
}

enum ExtractError: Error {
    case invalidArguments
    case couldNotCreateOutputDirectory
}

let args = CommandLine.arguments

guard args.count >= 3 else {
    fputs("Usage: swift extract_video_frames.swift <input-video> <output-dir>\n", stderr)
    throw ExtractError.invalidArguments
}

let inputPath = args[1]
let outputDirectory = args[2]
let fileManager = FileManager.default

if !fileManager.fileExists(atPath: outputDirectory) {
    do {
        try fileManager.createDirectory(atPath: outputDirectory, withIntermediateDirectories: true)
    } catch {
        fputs("Could not create output directory: \(outputDirectory)\n", stderr)
        throw ExtractError.couldNotCreateOutputDirectory
    }
}

let asset = AVAsset(url: URL(fileURLWithPath: inputPath))
let durationSeconds = CMTimeGetSeconds(asset.duration)
let safeDuration = durationSeconds.isFinite && durationSeconds > 0 ? durationSeconds : 4.0
let frameCount = max(2, min(4, Int(ceil(safeDuration / 3.0))))
let intervalSeconds = max(1.0, safeDuration / Double(frameCount + 1))

let imageGenerator = AVAssetImageGenerator(asset: asset)
imageGenerator.appliesPreferredTrackTransform = true
imageGenerator.maximumSize = CGSize(width: 900, height: 900)

var outputFrames: [String] = []

for index in 0..<frameCount {
    let second = min(safeDuration, intervalSeconds * Double(index + 1))
    let time = CMTime(seconds: second, preferredTimescale: 600)

    do {
        let imageRef = try imageGenerator.copyCGImage(at: time, actualTime: nil)
        let image = NSImage(cgImage: imageRef, size: .zero)
        let destinationPath = "\(outputDirectory)/frame-\(String(format: "%03d", index + 1)).png"

        guard
            let tiffData = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiffData),
            let pngData = bitmap.representation(using: .png, properties: [:])
        else {
            continue
        }

        try pngData.write(to: URL(fileURLWithPath: destinationPath))
        outputFrames.append(destinationPath)
    } catch {
        continue
    }
}

let output = Output(durationSeconds: safeDuration, intervalSeconds: intervalSeconds, frames: outputFrames)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted]
let data = try encoder.encode(output)
FileHandle.standardOutput.write(data)
