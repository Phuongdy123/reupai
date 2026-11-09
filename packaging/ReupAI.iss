#define MyAppName "ReupAI Local Engine"
#define MyAppVersion "0.2.40"
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
Compression=lzma2/normal
LZMANumBlockThreads=2
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
Source: "close-engine-for-update.ps1"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\ReupAI"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\ReupAI"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\ReupAI Local Engine"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--background"; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Khởi động ReupAI Local Engine"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup(): Boolean;
var
  InstalledVersion: String;
begin
  Result := True;
  if RegQueryStringValue(HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\{72A51D30-33F4-4EF9-BBC6-76BB73BB47E9}_is1',
    'DisplayVersion', InstalledVersion) and
    (InstalledVersion = '{#MyAppVersion}') and (not WizardSilent) then
  begin
    Result := MsgBox('ReupAI {#MyAppVersion} đã được cài trên máy này.' + #13#10 +
      'Bạn chỉ cần cài lại nếu muốn sửa bản cài đặt hiện có. Tiếp tục?',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  ScriptPath: String;
begin
  Result := '';
  if not FileExists(ExpandConstant('{app}\{#MyAppExeName}')) then
    Exit;

  ExtractTemporaryFile('close-engine-for-update.ps1');
  ScriptPath := ExpandConstant('{tmp}\close-engine-for-update.ps1');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ' +
      AddQuotes(ScriptPath) + ' -InstallDir ' + AddQuotes(ExpandConstant('{app}')),
    '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
  begin
    Result := 'Không thể chuẩn bị cập nhật ReupAI. Hãy đóng Local Engine ở khay hệ thống rồi thử lại.';
    Exit;
  end;

  case ExitCode of
    0: Log('ReupAI Local Engine has stopped for the update.');
    10: Result := 'ReupAI đang tải hoặc xử lý video. Hãy đợi công việc hoàn tất rồi cài đặt lại.';
    11: Result := 'Không đọc được trạng thái Local Engine. Hãy thoát ReupAI ở khay hệ thống rồi cài đặt lại.';
    12: Result := 'Không tìm thấy cửa sổ điều khiển Local Engine. Hãy thoát ReupAI ở khay hệ thống rồi cài đặt lại.';
    13: Result := 'Local Engine chưa thoát sau 20 giây. Hãy đóng ứng dụng rồi cài đặt lại.';
    14: Result := 'Bản Local Engine đang chạy chưa báo đủ trạng thái công việc. Hãy thoát ReupAI ở khay hệ thống rồi cài đặt lại.';
    15: Result := 'Không xác nhận được tiến trình Local Engine. Hãy thoát ReupAI ở khay hệ thống rồi cài đặt lại.';
  else
    Result := 'Không thể đóng Local Engine để cập nhật (mã ' + IntToStr(ExitCode) + '). Hãy thoát ứng dụng rồi cài đặt lại.';
  end;
end;

