#define MyAppName "ReupAI Local Engine"
#define MyAppVersion "0.2.13"
#define MyAppPublisher "ReupAI"
#define MyAppURL "https://www.reupai.cloud"
#define MyAppExeName "ReupAI.exe"

[Setup]
AppId={{72A51D30-33F4-4EF9-BBC6-76BB73BB47E9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\ReupAI
DefaultGroupName=ReupAI
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=ReupAI-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Tạo lối tắt ngoài màn hình"; GroupDescription: "Tùy chọn:"; Flags: unchecked
Name: "startup"; Description: "Khởi động ReupAI cùng Windows"; GroupDescription: "Tùy chọn:"; Flags: unchecked

[Files]
Source: "..\dist\ReupAI\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ReupAI"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\ReupAI"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\ReupAI Local Engine"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--background"; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Khởi động ReupAI Local Engine"; Flags: nowait postinstall skipifsilent


