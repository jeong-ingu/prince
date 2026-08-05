# 로그오프 중에도 자동 수집이 실행되도록 작업을 재등록합니다.
# ※ 반드시 "관리자 권한" PowerShell 에서 실행하세요.
#   실행: 시작 → PowerShell 우클릭 → "관리자 권한으로 실행" → 아래 명령
#         powershell -ExecutionPolicy Bypass -File "C:\Users\WIN_AD03216734\projects\land\enable-logoff.ps1"

$action   = New-ScheduledTaskAction -Execute "C:\Users\WIN_AD03216734\projects\land\scrape-task.cmd"
$t1       = New-ScheduledTaskTrigger -Daily -At 9:00am
$t2       = New-ScheduledTaskTrigger -Daily -At 3:00pm
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# S4U: 비밀번호 저장 없이 "로그온 여부와 무관하게" 실행
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName "WangsimniXi-Scrape" -Action $action -Trigger $t1,$t2 `
  -Settings $settings -Principal $principal `
  -Description "왕십리자이 매물 자동 수집 (매일 09:00, 15:00, 로그오프 중에도 실행)" -Force

$t = Get-ScheduledTask -TaskName "WangsimniXi-Scrape"
Write-Host ("완료 — LogonType: " + $t.Principal.LogonType + " (S4U 이면 로그오프 중 실행됨)")
Write-Host ("다음 실행: " + (Get-ScheduledTaskInfo -TaskName "WangsimniXi-Scrape").NextRunTime)
