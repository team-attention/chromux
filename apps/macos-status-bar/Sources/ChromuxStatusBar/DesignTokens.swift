import SwiftUI

/// Color tokens ported from status-app/DESIGN.md so the native window reads as
/// one continuous dark surface with the rest of the chromux visual system.
enum DesignTokens {
    static let canvas = Color(hex: 0x010102)
    static let surface1 = Color(hex: 0x0F1011)
    static let surface2 = Color(hex: 0x141516)
    static let ink = Color(hex: 0xF7F8F8)
    static let inkMuted = Color(hex: 0xD0D6E0)
    static let inkSubtle = Color(hex: 0x8A8F98)
    static let hairline = Color(hex: 0x23252A)
    static let primary = Color(hex: 0x5E6AD2)
    static let semanticSuccess = Color(hex: 0x27A644)
}

extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}
