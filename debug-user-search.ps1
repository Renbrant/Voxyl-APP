# Debug script to test user search and follow endpoints

$apiBase = "https://api.voxyl.renbrant.com/api"
$token = Read-Host "Paste your auth token (from browser DevTools)"

if (-not $token) {
    Write-Host "❌ Token is required" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

Write-Host "`n=== Test 1: Get current user ===" -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri "$apiBase/me" -Headers $headers -Method GET | ConvertFrom-Json
    $userId = $resp.user.id
    Write-Host "✅ Current user ID: $userId" -ForegroundColor Green
    Write-Host "   Name: $($resp.user.name)" -ForegroundColor Green
    Write-Host "   Username: $($resp.user.username)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to get current user: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Test 2: Search users (empty query) ===" -ForegroundColor Cyan
try {
    $body = @{ query = "" } | ConvertTo-Json
    $resp = Invoke-WebRequest -Uri "$apiBase/functions/searchUsers" -Headers $headers -Method POST -Body $body | ConvertFrom-Json
    Write-Host "✅ Found $($resp.data.users.Length) users" -ForegroundColor Green
    $resp.data.users | ForEach-Object {
        Write-Host "   - $($_.username) (ID: $($_.id))" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Failed to search users: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Test 3: Get followers (following_id = current user) ===" -ForegroundColor Cyan
try {
    $url = "$apiBase/entities/follow?following_id=$userId&status=accepted"
    $resp = Invoke-WebRequest -Uri $url -Headers $headers -Method GET | ConvertFrom-Json
    $items = $resp.items ?? $resp.data ?? @()
    Write-Host "✅ Found $($items.Length) followers" -ForegroundColor Green
    $items | ForEach-Object {
        Write-Host "   - Follower: $($_.follower_username) (ID: $($_.follower_id))" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Failed to get followers: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Test 4: Get following (follower_id = current user) ===" -ForegroundColor Cyan
try {
    $url = "$apiBase/entities/follow?follower_id=$userId&status=accepted"
    $resp = Invoke-WebRequest -Uri $url -Headers $headers -Method GET | ConvertFrom-Json
    $items = $resp.items ?? $resp.data ?? @()
    Write-Host "✅ Found $($items.Length) users I'm following" -ForegroundColor Green
    $items | ForEach-Object {
        Write-Host "   - Following: $($_.following_username) (ID: $($_.following_id))" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Failed to get following: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Test 5: Search for specific user ===" -ForegroundColor Cyan
$searchTerm = Read-Host "Enter username to search (or press Enter to skip)"
if ($searchTerm) {
    try {
        $body = @{ query = $searchTerm } | ConvertTo-Json
        $resp = Invoke-WebRequest -Uri "$apiBase/functions/searchUsers" -Headers $headers -Method POST -Body $body | ConvertFrom-Json
        Write-Host "✅ Found $($resp.data.users.Length) results" -ForegroundColor Green
        $resp.data.users | ForEach-Object {
            Write-Host "   - $($_.username) (ID: $($_.id))" -ForegroundColor Green
        }
    } catch {
        Write-Host "❌ Failed to search: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n=== All tests completed ===" -ForegroundColor Cyan
