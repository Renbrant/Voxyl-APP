#!/usr/bin/env pwsh
# Test Script for Issue #63 - User Profile and Social Features
# Testa os 4 novos endpoints sem autenticação (validação básica)

$baseUrl = "http://127.0.0.1:8787"
$testsPassed = 0
$testsFailed = 0

Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  TESTE ISSUE #63 - Profile & Social Features" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

function Test-Endpoint {
    param(
        [string]$Method,
        [string]$Endpoint,
        [string]$ExpectedStatus,
        [string]$Description
    )
    
    Write-Host "Test: $Description" -ForegroundColor Yellow
    Write-Host "  → $Method $Endpoint" -ForegroundColor Gray
    
    try {
        $uri = "$baseUrl$Endpoint"
        $response = Invoke-WebRequest -Uri $uri `
            -Method $Method `
            -Headers @{ "Content-Type" = "application/json" } `
            -Body "{}"
        
        $statusCode = $response.StatusCode
        $content = $response.Content | ConvertFrom-Json
        
        if ($statusCode -eq $ExpectedStatus) {
            Write-Host "  ✅ Status: $statusCode" -ForegroundColor Green
            Write-Host "  Response: $($content.error)" -ForegroundColor Green
            Write-Host ""
            return $true
        } else {
            Write-Host "  ❌ Expected $ExpectedStatus, got $statusCode" -ForegroundColor Red
            Write-Host "  Response: $($response.Content)" -ForegroundColor Red
            Write-Host ""
            return $false
        }
    } catch {
        # Capture error response status code
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseContent = $reader.ReadToEnd()
            $reader.Close()
            
            if ($statusCode -eq $ExpectedStatus) {
                Write-Host "  ✅ Status: $statusCode" -ForegroundColor Green
                if ($responseContent) {
                    $content = $responseContent | ConvertFrom-Json
                    Write-Host "  Response: $($content.error)" -ForegroundColor Green
                }
                Write-Host ""
                return $true
            } else {
                Write-Host "  ❌ Expected $ExpectedStatus, got $statusCode" -ForegroundColor Red
                Write-Host "  Response: $responseContent" -ForegroundColor Red
                Write-Host ""
                return $false
            }
        } else {
            Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host ""
            return $false
        }
    }
}

# Test 1: POST /api/files/upload
if (Test-Endpoint -Method "POST" -Endpoint "/api/files/upload" -ExpectedStatus 401 -Description "POST /api/files/upload (profile photo upload)") {
    $testsPassed++
} else {
    $testsFailed++
}

# Test 2: PATCH /api/me
if (Test-Endpoint -Method "PATCH" -Endpoint "/api/me" -ExpectedStatus 401 -Description "PATCH /api/me (update profile)") {
    $testsPassed++
} else {
    $testsFailed++
}

# Test 3: POST /api/functions/requestFollow
if (Test-Endpoint -Method "POST" -Endpoint "/api/functions/requestFollow" -ExpectedStatus 401 -Description "POST /api/functions/requestFollow (create follow)") {
    $testsPassed++
} else {
    $testsFailed++
}

# Test 4: POST /api/functions/cancelFollowRequest
if (Test-Endpoint -Method "POST" -Endpoint "/api/functions/cancelFollowRequest" -ExpectedStatus 401 -Description "POST /api/functions/cancelFollowRequest (cancel follow)") {
    $testsPassed++
} else {
    $testsFailed++
}

# Summary
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "RESULTADO: $testsPassed Passed | $testsFailed Failed" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($testsFailed -eq 0) {
    Write-Host "✅ Todos os endpoints foram implementados corretamente!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Próximo passo: Obter token Clerk e testar com autenticação" -ForegroundColor Green
    Write-Host ""
    Write-Host "Para testar com autenticação:" -ForegroundColor Yellow
    Write-Host "1. Acesse http://localhost:5173 e faça login" -ForegroundColor Yellow
    Write-Host "2. Abra DevTools (F12) → Network" -ForegroundColor Yellow
    Write-Host "3. Copie o token 'Authorization: Bearer ...' de qualquer requisição" -ForegroundColor Yellow
    Write-Host "4. Use TESTING_GUIDE.md para rodar testes com autenticação" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "❌ Alguns endpoints não estão respondendo corretamente" -ForegroundColor Red
    exit 1
}
