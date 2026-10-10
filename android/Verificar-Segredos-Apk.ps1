param([Parameter(Mandatory=$true)][string]$ApkPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ApkPath).Path)
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName.EndsWith('/')) { continue }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $texto = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($texto -match 'gsk_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}') {
            throw "Publicação bloqueada: credencial encontrada em $($entry.FullName). O valor não será exibido."
        }
        if ($entry.FullName -match '(^|/)config\.json$') {
            $cfg = $texto | ConvertFrom-Json
            foreach ($nome in @('groqKey','geminiKey','GROQ_API_KEY','GEMINI_API_KEY')) {
                if ($cfg.$nome) { throw "Publicação bloqueada: segredo $nome no APK." }
            }
        }
    }
} finally { $zip.Dispose() }
Write-Output 'APK verificado: nenhuma credencial de IA ou GitHub detectada.'
