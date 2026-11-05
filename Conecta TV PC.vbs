' Abre o Conecta TV no computador (player 4K), sem janela de terminal.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta
sh.Run "node """ & pasta & "\pc\conecta-pc.cjs""", 0, False
