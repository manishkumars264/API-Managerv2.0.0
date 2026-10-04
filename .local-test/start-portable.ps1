param([string]$Executable, [int]$Port)
$portableProcess = Start-Process -FilePath $Executable -ArgumentList "--remote-debugging-port=$Port" -WindowStyle Hidden -PassThru
@{ id = $portableProcess.Id; started = $portableProcess.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
