# Winget / App Installer Resources

Large Microsoft App Installer resource files are intentionally not stored in this source repository.

The installer can download winget/App Installer dependencies at runtime when bundled offline resources are unavailable. Release builds may include these files inside the packaged executable or release assets, but they are excluded from Git to avoid GitHub source repository size limits.

Ignored examples:

- `Microsoft.DesktopAppInstaller.msixbundle`
- `Microsoft.VCLibs*.appx`
- `Microsoft.UI.Xaml*.appx`
- `DesktopAppInstaller_Dependencies/**`
