param([ValidatePattern('^[a-z0-9-]+$')][string]$WalletDirectory = 'orderanchor-bot')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows DPAPI is required' }
$projectPath = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path (Join-Path $projectPath 'secrets') $WalletDirectory
if (Test-Path -LiteralPath $secretPath) { throw 'Bot wallet directory already exists; refusing to overwrite' }
Push-Location $projectPath
try {
    # No private key is passed as an argument, environment variable, or printed.
    $generatedJson = & node --input-type=module -e 'import {generatePrivateKey,privateKeyToAccount} from "viem/accounts"; const key=generatePrivateKey(); process.stdout.write(JSON.stringify({key,address:privateKeyToAccount(key).address}));'
    if ($LASTEXITCODE -ne 0) { throw 'Local wallet generation failed' }
    $generated = $generatedJson | ConvertFrom-Json
    $protectedKey = ConvertFrom-SecureString (ConvertTo-SecureString -String $generated.key -AsPlainText -Force)
    $restoredSecure = ConvertTo-SecureString -String $protectedKey
    $restored = [System.Net.NetworkCredential]::new('', $restoredSecure).Password
    $verifiedAddress = $restored | & node --input-type=module -e 'import {privateKeyToAccount} from "viem/accounts"; let input=""; for await(const chunk of process.stdin) input+=chunk; process.stdout.write(privateKeyToAccount(input.trim()).address);'
    if ($LASTEXITCODE -ne 0 -or $verifiedAddress -cne $generated.address) { throw 'DPAPI round-trip verification failed' }
    $null = New-Item -ItemType Directory -Path $secretPath
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($currentSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($currentSid, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $secretPath -AclObject $acl
    $keyPath = Join-Path $secretPath 'private-key.dpapi'
    [System.IO.File]::WriteAllText($keyPath, $protectedKey)
    # Verify the actual persisted encrypted file before publishing its address.
    $persistedSecure = ConvertTo-SecureString -String ([System.IO.File]::ReadAllText($keyPath))
    $persistedKey = [System.Net.NetworkCredential]::new('', $persistedSecure).Password
    $persistedAddress = $persistedKey | & node --input-type=module -e 'import {privateKeyToAccount} from "viem/accounts"; let input=""; for await(const chunk of process.stdin) input+=chunk; process.stdout.write(privateKeyToAccount(input.trim()).address);'
    if ($LASTEXITCODE -ne 0 -or $persistedAddress -cne $generated.address) { throw 'Persisted wallet verification failed' }
    $metadata = [ordered]@{
        address = $generated.address
        chainId = 50383
        createdUtc = [DateTime]::UtcNow.ToString('o')
        protection = 'Windows DPAPI CurrentUser; current Windows user and SYSTEM file ACL'
        windowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        keyFile = $keyPath
        roundTripVerified = $true
        linked = $false
        funded = $false
    }
    $publicJson = $metadata | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $secretPath 'wallet.public.json'), $publicJson)
    $publicJson
} finally {
    $generatedJson = $null; $generated = $null; $restored = $null; $persistedKey = $null
    Pop-Location
}
