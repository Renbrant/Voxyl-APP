# Teste Manual - Issue #63 User Profile and Social Features

## Pré-requisitos

✅ Worker rodando: `http://127.0.0.1:8787`
✅ App rodando: `http://localhost:5173` (não precisa estar carregando, só para login)

## Método 1: Teste Rápido com Curl (SEM AUTENTICAÇÃO)

Todos os endpoints devem retornar **401 Unauthorized** (behavior correto):

```powershell
# Test 1: POST /api/files/upload (sem file, sem auth)
curl.exe -X POST http://127.0.0.1:8787/api/files/upload -H "Content-Type: application/json" -d "{}"
# Esperado: {"ok":false,"authenticated":false,"error":"Unauthorized"}

# Test 2: PATCH /api/me (sem auth)
curl.exe -X PATCH http://127.0.0.1:8787/api/me -H "Content-Type: application/json" -d "{}"
# Esperado: {"ok":false,"authenticated":false,"error":"Unauthorized"}

# Test 3: POST /api/functions/requestFollow (sem auth)
curl.exe -X POST http://127.0.0.1:8787/api/functions/requestFollow -H "Content-Type: application/json" -d '{"targetUserId":"test"}'
# Esperado: {"ok":false,"authenticated":false,"error":"Unauthorized"}

# Test 4: POST /api/functions/cancelFollowRequest (sem auth)
curl.exe -X POST http://127.0.0.1:8787/api/functions/cancelFollowRequest -H "Content-Type: application/json" -d '{"targetUserId":"test"}'
# Esperado: {"ok":false,"authenticated":false,"error":"Unauthorized"}
```

## Método 2: Teste Automático com Node.js

```bash
cd c:\GitHub\Voxyl-APP
npm run test
```

Este comando roda toda a suite de testes (304 testes, todos devem passar).

## Método 3: Teste Manual Completo (COM AUTENTICAÇÃO)

### Passo 1: Obter Token Clerk

1. Abra `http://localhost:5173` em seu navegador
2. Faça login com sua conta Clerk
3. Abra Developer Tools (F12)
4. Vá à aba **Network** 
5. Faça qualquer requisição de API (ex: carregar um podcast)
6. Clique em qualquer requisição e procure pelo header:
   ```
   Authorization: Bearer eyJhbGc...
   ```
7. Copie o token (apenas a parte após "Bearer ")

### Passo 2: Exportar Token para PowerShell

```powershell
$TOKEN = "eyJhbGc..."  # Cole aqui o token que você copiou
```

### Passo 3: Testar Endpoints

#### A) Test POST /api/files/upload (Upload de Foto)

```powershell
# Criar imagem de teste (1x1 PNG)
$imageBytes = @(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 216, 0, 0, 0, 12, 73, 68, 65, 84, 8, 29, 1, 1, 0, 0, 0, 128, 128, 0, 0, 0, 0, 0, 0, 0, 0, 34, 230, 167, 32, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130) -as [byte[]]
$imageBytes | Set-Content -Path temp_image.png -Encoding Byte

# Upload
$headers = @{
    "Authorization" = "Bearer $TOKEN"
}
$file = Get-Item temp_image.png
$response = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/files/upload" `
    -Method POST `
    -Headers $headers `
    -Form @{ file = $file } `
    -ContentType "multipart/form-data"

Write-Host "Upload Response:" -ForegroundColor Green
$response.Content | ConvertFrom-Json | Format-Table -AutoSize

# Resultado esperado:
# {
#   "file_url": "https://media.renbrant.com/profiles/..."
# }
```

#### B) Test PATCH /api/me (Salvar Photo na Profile)

```powershell
$TOKEN = "seu_token_aqui"
$headers = @{
    "Authorization" = "Bearer $TOKEN"
    "Content-Type" = "application/json"
}

$body = @{
    profile_picture = "https://media.renbrant.com/profiles/test.jpg"
    profile_hidden = $false
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/me" `
    -Method PATCH `
    -Headers $headers `
    -Body $body

Write-Host "Profile Update Response:" -ForegroundColor Green
$response.Content | ConvertFrom-Json | Format-Table -AutoSize

# Resultado esperado:
# {
#   "data": {
#     "id": "user_xyz",
#     "profile_picture": "https://media.renbrant.com/profiles/test.jpg",
#     "profile_hidden": false,
#     ...
#   }
# }
```

#### C) Test requestFollow (Seguir Usuário)

```powershell
$TOKEN = "seu_token_aqui"
$targetUserId = "user_id_of_person_to_follow"  # Substitua com ID real

$headers = @{
    "Authorization" = "Bearer $TOKEN"
    "Content-Type" = "application/json"
}

$body = @{
    targetUserId = $targetUserId
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/functions/requestFollow" `
    -Method POST `
    -Headers $headers `
    -Body $body

Write-Host "Request Follow Response:" -ForegroundColor Green
$response.Content | ConvertFrom-Json | Format-Table -AutoSize

# Resultado esperado:
# {
#   "data": {
#     "id": "follow_id",
#     "status": "pending"
#   }
# }
```

#### D) Test cancelFollowRequest (Parar de Seguir)

```powershell
$TOKEN = "seu_token_aqui"
$targetUserId = "user_id_of_person_to_unfollow"

$headers = @{
    "Authorization" = "Bearer $TOKEN"
    "Content-Type" = "application/json"
}

$body = @{
    targetUserId = $targetUserId
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/functions/cancelFollowRequest" `
    -Method POST `
    -Headers $headers `
    -Body $body

Write-Host "Cancel Follow Response:" -ForegroundColor Green
$response.Content | ConvertFrom-Json | Format-Table -AutoSize

# Resultado esperado:
# {
#   "data": {
#     "deleted": true
#   }
# }
```

## Validação Checklist

- [ ] **POST /api/files/upload** retorna `file_url` válido
- [ ] **PATCH /api/me** persiste `profile_picture` e `profile_hidden`
- [ ] **requestFollow** cria follow com `status: "pending"`
- [ ] **cancelFollowRequest** retorna `deleted: true`
- [ ] Todos os 304 testes passam com `npm run test`
- [ ] Sem erros no console do Worker

## Troubleshooting

### "curl command not found"
Use: `curl.exe` em vez de `curl`

### "401 Unauthorized esperado"
- Verifique se o token é válido e não expirou
- Token deve estar depois de "Bearer "
- Verifique se há space depois de "Bearer"

### Erro de CORS
- Esperado se testar do navegador sem CORS headers
- Worker adiciona `withCors()` automaticamente

## Próximos Passos

Se tudo passar aqui, o código está pronto para merge! 🚀

```bash
git checkout main
git merge fix/issue-63-user-profile-social
git push
gh issue close 63 --comment "✅ Phase 2 implementation complete..."
```
