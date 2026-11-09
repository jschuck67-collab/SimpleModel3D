<# :
@echo off
cd /d "%~dp0"
title Build SimpleModel3D Student Version
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([System.IO.File]::ReadAllText('%~f0'))"
echo.
pause
exit /b
#>

$ErrorActionPreference = "Stop"
$root = (Get-Location).Path

$html = Get-Content -Path (Join-Path $root "index.html") -Raw -Encoding UTF8
$css  = Get-Content -Path (Join-Path $root "styles.css") -Raw -Encoding UTF8
$svgBytes = [System.IO.File]::ReadAllBytes((Join-Path $root "icon.svg"))
$svgBase64 = [Convert]::ToBase64String($svgBytes)

$moduleOrder = @(
    "js/utils.js",
    "js/state.js",
    "js/ui.js",
    "js/scene.js",
    "js/sceneSetup.js",
    "js/shapes.js",
    "js/booleanOps.js",
    "js/modifiers.js",
    "js/tools.js",
    "js/io.js",
    "js/main.js"
)

$externalImports = @"
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
"@

$combinedJs = $externalImports + "`r`n"

foreach ($relPath in $moduleOrder) {
    $fullPath = Join-Path $root $relPath
    $content = Get-Content -Path $fullPath -Raw -Encoding UTF8
    $content = [regex]::Replace($content, '(?m)^\s*import\s+.*?;?\s*$', '')
    $content = [regex]::Replace($content, '(?m)^\s*export\s+(function|const|let|var)\s+', '$1 ')
    $combinedJs += "`r`n// === $relPath ===`r`n" + $content.Trim() + "`r`n"
}

$standaloneHtml = $html -replace '<link rel="stylesheet" href="styles\.css">', "<style>`r`n$css`r`n</style>"
$standaloneHtml = $standaloneHtml -replace '<link rel="icon" type="image/svg\+xml" href="\.\/icon\.svg">', "<link rel=`"icon`" type=`"image/svg+xml`" href=`"data:image/svg+xml;base64,$svgBase64`">"
$standaloneHtml = $standaloneHtml -replace '<link rel="manifest" href="\.\/manifest\.json">\s*', ''
$standaloneHtml = [regex]::Replace($standaloneHtml, '(?s)<script type="module" src="js/main\.js"></script>.*?</body>', "<script type=`"module`">`r`n$combinedJs`r`n</script>`r`n</body>")

$outFile = Join-Path $root "SimpleModel3D-Student.html"
[System.IO.File]::WriteAllText($outFile, $standaloneHtml, [System.Text.UTF8Encoding]::new($false))
Write-Host "SUCCESS! Updated: $outFile" -ForegroundColor Green
