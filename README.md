# Read Aloud for Zen

Read pages with system voices or voices from your installed Microsoft Edge, with word highlighting.

1. Install [Microsoft Edge](https://www.microsoft.com/edge) and Python 3.
2. Run `connector-windows/Install-Windows.bat` or `connector-macos/Install.command`.
3. In Zen's `about:config`, set `xpinstall.signatures.required` to `false`. In `about:addons`, open the gear menu and choose **Install Add-on From File** for `Read-Aloud-Core.xpi`.
4. Import `Aria-provider.json` in Read Aloud > Voice Options > Configure speech API.

Select a word and press `Cmd+Shift+U` on macOS or `Ctrl+Shift+U` on Windows to continue reading from there. Online voices send reading text to Microsoft. The Zen setting permits other unsigned add-ons, so install only ones you trust.
