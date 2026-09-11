// Run with /usr/bin/osascript -l JavaScript. AppKit supplies the system folder
// chooser, including New Folder; only its selected absolute path leaves it.
ObjC.import("AppKit");
ObjC.import("Foundation");

function run(argv) {
  var panel = $.NSOpenPanel.openPanel;
  panel.title = "Choose a workspace";
  panel.prompt = "Open workspace";
  panel.canChooseDirectories = true;
  panel.canChooseFiles = false;
  panel.canCreateDirectories = true;
  panel.allowsMultipleSelection = false;
  panel.resolvesAliases = true;

  // Inspect the real AppKit configuration without displaying a dialog.
  if (argv[0] === "--inspect") {
    return JSON.stringify({
      directories: Boolean(panel.canChooseDirectories),
      files: Boolean(panel.canChooseFiles),
      newFolder: Boolean(panel.canCreateDirectories),
      multiple: Boolean(panel.allowsMultipleSelection),
    });
  }
  if (argv[0]) panel.directoryURL = $.NSURL.fileURLWithPath(argv[0]);
  var app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
  app.activateIgnoringOtherApps(true);
  if (panel.runModal !== $.NSModalResponseOK)
    return JSON.stringify({ path: null });
  return JSON.stringify({ path: ObjC.unwrap(panel.URL.path) });
}
