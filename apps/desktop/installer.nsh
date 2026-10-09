; WSLPilot NSIS 自定义脚本
; 由 electron-builder 的 nsis.include 引入
; 参考: https://www.electron.build/configuration/nsis

; 安装前检查（可选扩展点）
!macro customInstall
  ; 预留：写入注册表 / 创建目录等
  DetailPrint "WSLPilot 安装中..."
!macroend

; 卸载时清理（保留用户配置，只清应用自身）
!macro customUnInstall
  DetailPrint "WSLPilot 卸载中..."
  ; 注意：不删除 %APPDATA%\WSLPilot 配置目录，保留用户配置
!macroend

; 自定义欢迎页说明（保留默认 UI，仅追加文本）
!macro customHeader
  !echo "WSLPilot NSIS header"
!macroend
