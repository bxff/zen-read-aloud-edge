# Read Aloud for Zen

Read pages with system voices or voices from your installed Microsoft Edge, with word highlighting.

1. Install [Microsoft Edge](https://www.microsoft.com/edge) and Python 3.
2. Run `connector-windows/Install-Windows.bat` or `connector-macos/Install.command`.
3. Load `Read-Aloud-Core.xpi` at `about:debugging#/runtime/this-firefox`, then import `Aria-provider.json` in Read Aloud > Voice Options > Configure speech API.

Select a word and press `Cmd+Shift+U` on macOS or `Ctrl+Shift+U` on Windows to continue reading from there. Reload the XPI after restarting Zen. Online voices send reading text to Microsoft.
