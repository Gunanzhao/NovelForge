[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('folder', 'file')]
  [string]$Mode,
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [string]$Title,
  [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windowCondition = if ($Title) {
  New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    $Title
  )
} else {
  [System.Windows.Automation.Condition]::TrueCondition
}

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$dialog = $null
while ([DateTime]::UtcNow -lt $deadline -and $null -eq $dialog) {
  $dialog = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  if ($null -eq $dialog) {
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($index = 0; $index -lt $windows.Count -and $null -eq $dialog; $index++) {
      $window = $windows.Item($index)
      $dialog = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $windowCondition)
    }
  }
  if ($null -eq $dialog) { Start-Sleep -Milliseconds 100 }
}
if ($null -eq $dialog) {
  throw "找不到原生文件对话框：$Title"
}
$buttonType = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)

function Resolve-Dialog {
  $direct = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  if ($null -ne $direct) {
    $directButtons = $direct.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonType)
    if ($directButtons.Count -gt 0) { return $direct }
  }
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($index = 0; $index -lt $windows.Count; $index++) {
    $nestedDialogs = $windows.Item($index).FindAll([System.Windows.Automation.TreeScope]::Descendants, $windowCondition)
    for ($nestedIndex = 0; $nestedIndex -lt $nestedDialogs.Count; $nestedIndex++) {
      $nested = $nestedDialogs.Item($nestedIndex)
      $nestedButtons = $nested.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonType)
      if ($nestedButtons.Count -gt 0) { return $nested }
    }
  }
  return $null
}

function Find-DescendantByName([System.Windows.Automation.AutomationElement]$parent, [string[]]$names) {
  foreach ($name in $names) {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $name
    )
    $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -ne $element) { return $element }
  }
  return $null
}

function Find-ButtonByName([System.Windows.Automation.AutomationElement]$parent, [string[]]$names) {
  $buttonType = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  foreach ($name in $names) {
    $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $name
    )
    $combined = New-Object System.Windows.Automation.AndCondition($nameCondition, $buttonType)
    $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $combined)
    if ($null -ne $element) { return $element }
  }
  return $null
}

function Find-Edit([System.Windows.Automation.AutomationElement]$parent) {
  $editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $idCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    '1152'
  )
  $combined = New-Object System.Windows.Automation.AndCondition($idCondition, $editCondition)
  $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $combined)
  if ($null -ne $element) { return $element }
  return $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
}

function Find-FileNameEdit([System.Windows.Automation.AutomationElement]$parent) {
  foreach ($id in @('1148', 'FileNameControlHost')) {
    $idCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      $id
    )
    $editType = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $combined = New-Object System.Windows.Automation.AndCondition($idCondition, $editType)
    $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $combined)
    if ($null -ne $element) { return $element }
  }
  foreach ($name in @('文件名:', '文件名', 'File name:', 'File name')) {
    $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $name
    )
    $editType = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $combined = New-Object System.Windows.Automation.AndCondition($nameCondition, $editType)
    $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $combined)
    if ($null -ne $element) { return $element }
  }
  # Windows common dialogs can expose the file name host without a stable
  # AutomationId while the folder view is refreshing. Prefer an enabled edit
  # that is not the address bar as a final, non-index-based fallback.
  $editType = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $edits = $parent.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editType)
  for ($index = $edits.Count - 1; $index -ge 0; $index--) {
    $candidate = $edits.Item($index)
    try {
      if ($candidate.Current.IsEnabled -and $candidate.Current.AutomationId -ne '41477') { return $candidate }
    } catch {
      # The common dialog may replace this control between enumeration calls.
    }
  }
  return $null
}

function Wait-DialogClosed([int]$seconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($null -eq (Resolve-Dialog)) { return $true }
    Start-Sleep -Milliseconds 120
  }
  return $false
}

function Submit-FilePathByKeyboard([System.Windows.Automation.AutomationElement]$parent, [string]$filePath, [int]$seconds) {
  try {
    $parent.SetFocus()
    # Alt+N is the stable Windows common-dialog accelerator for “File name”.
    # It works even while the list view is rebuilding and avoids list indexes.
    [System.Windows.Forms.SendKeys]::SendWait('%n')
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait($filePath)
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    return Wait-DialogClosed $seconds
  } catch {
    return $false
  }
}

function Find-AddressEdit([System.Windows.Automation.AutomationElement]$parent) {
  $idCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    '41477'
  )
  $editType = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $combined = New-Object System.Windows.Automation.AndCondition($idCondition, $editType)
  $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $combined)
  if ($null -ne $element) { return $element }
  $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    '地址'
  )
  $editType = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $combinedByName = New-Object System.Windows.Automation.AndCondition($nameCondition, $editType)
  return $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $combinedByName)
}

function Dialog-LocationMatches([System.Windows.Automation.AutomationElement]$parent, [string]$directoryPath) {
  $expected = [IO.Path]::GetFullPath($directoryPath).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  try {
    $address = Find-AddressEdit $parent
    if ($null -ne $address) {
      $valuePattern = $address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $value = [string]$valuePattern.Current.Value
      if ($value -and $value.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) -ieq $expected) { return $true }
    }
  } catch {
    # Some Explorer builds expose the address only as a toolbar name.
  }
  try {
    $descendants = $parent.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    for ($index = 0; $index -lt $descendants.Count; $index++) {
      $name = [string]$descendants.Item($index).Current.Name
      if (-not $name) { continue }
      if ($name -match '^地址:\s*(.+)$') {
        $location = $Matches[1].Trim().TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        if ($location -ieq $expected) { return $true }
      }
    }
  } catch {
    # The control tree can be rebuilt while the folder view refreshes.
  }
  return $false
}

function Set-EditText([System.Windows.Automation.AutomationElement]$element, [string]$value) {
  if ($null -eq $element) { throw '原生文件对话框输入控件为空' }
  $valuePattern = $null
  $valuePatternError = $null
  # Prefer UIA ValuePattern: SendKeys can race the Explorer address bar and
  # append to its existing drive-qualified value (for example E:E:\...).
  try {
    $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $valuePattern.SetValue($value)
    if ($valuePattern.Current.Value -eq $value) { return }
  } catch {
    $valuePatternError = $_.Exception.Message
  }
  try {
    $element.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait($value)
    $sendKeysDeadline = [DateTime]::UtcNow.AddSeconds(2)
    while ([DateTime]::UtcNow -lt $sendKeysDeadline) {
      if ($null -eq $valuePattern) { $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) }
      if ($valuePattern.Current.Value -eq $value) { return }
      Start-Sleep -Milliseconds 100
    }
    throw "SendKeys 写入后值不匹配"
  } catch {
    throw "原生文件对话框无法填写路径：$value；ValuePattern=$valuePatternError；SendKeys=$($_.Exception.Message)"
  }
}

function Navigate-To([System.Windows.Automation.AutomationElement]$parent, [string]$directoryPath) {
  $directory = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($directoryPath))
  $parent.SetFocus()
  $address = Find-AddressEdit $parent
  if ($null -eq $address) {
    [System.Windows.Forms.SendKeys]::SendWait('^l')
    Start-Sleep -Milliseconds 250
    $address = Find-AddressEdit $parent
  }
  if ($null -eq $address) { throw "原生文件对话框缺少地址栏：$Title" }
  Set-EditText $address $directory.FullName
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  $directoryDeadline = [DateTime]::UtcNow.AddSeconds(8)
  while ([DateTime]::UtcNow -lt $directoryDeadline) {
    $freshDialog = Resolve-Dialog
    if ($null -ne $freshDialog) {
      try {
        if (Dialog-LocationMatches $freshDialog $directory.FullName) { return $directory.Name }
      } catch {
        # Address and breadcrumb controls are replaced while Explorer refreshes.
      }
    }
    Start-Sleep -Milliseconds 120
  }
  throw "原生文件对话框导航未完成：$($directory.FullName)"
}

$target = [IO.Path]::GetFullPath($Path)
$leaf = [IO.Path]::GetFileName($target.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
if ($Mode -eq 'folder') {
  if (-not [IO.Directory]::Exists($target)) { throw "目标文件夹不存在：$target" }
  # The folder-name edit treats a drive-qualified path as relative on some
  # Windows builds (producing E:E:\...). Navigate through the address bar
  # instead, then invoke the picker’s “选择文件夹” button.
  Navigate-To $dialog $target | Out-Null
  $freshDialog = Resolve-Dialog
  if ($null -ne $freshDialog) { $dialog = $freshDialog }
} else {
  $parentDirectory = [IO.DirectoryInfo]::new($target).Parent
  if ($null -eq $parentDirectory) { throw "无法确定原生选择器目标父目录：$target" }
  Navigate-To $dialog $parentDirectory.FullName | Out-Null
}
$refreshDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
while ([DateTime]::UtcNow -lt $refreshDeadline) {
  $refreshedDialog = Resolve-Dialog
  if ($null -ne $refreshedDialog) {
    $dialogButtons = $refreshedDialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonType)
    if ($dialogButtons.Count -gt 0) { $dialog = $refreshedDialog; break }
  }
  Start-Sleep -Milliseconds 100
}

$candidate = $null
if ($Mode -eq 'file') {
  if (Submit-FilePathByKeyboard $dialog $target 3) {
    Write-Output 'NATIVE_DIALOG_OK'
    exit 0
  }
  $fileNameEdit = $null
  $fileEditDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $fileEditDeadline -and $null -eq $fileNameEdit) {
    $freshDialog = Resolve-Dialog
    if ($null -ne $freshDialog) {
      try {
        $freshFileNameEdit = Find-FileNameEdit $freshDialog
        if ($null -ne $freshFileNameEdit) {
          $dialog = $freshDialog
          $fileNameEdit = $freshFileNameEdit
          break
        }
      } catch {
        # The common dialog can replace its controls while the directory loads.
      }
    }
    Start-Sleep -Milliseconds 100
  }
  if ($null -ne $fileNameEdit) {
    Set-EditText $fileNameEdit $target
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    if (Wait-DialogClosed 5) { Write-Output 'NATIVE_DIALOG_OK'; exit 0 }
  }
  $listCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ListItem
  )
  $listDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $items = @()
  while ([DateTime]::UtcNow -lt $listDeadline -and $null -eq $candidate) {
    $freshDialog = Resolve-Dialog
    if ($null -ne $freshDialog) { $dialog = $freshDialog }
    try { $items = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $listCondition) } catch { $items = @() }
    for ($index = 0; $index -lt $items.Count -and $null -eq $candidate; $index++) {
      try {
        if ($items.Item($index).Current.Name -eq $leaf) { $candidate = $items.Item($index) }
      } catch {
        # Ignore a stale list item and re-enumerate on the next poll.
      }
    }
    if ($null -eq $candidate) {
      $listViewCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        'listview'
      )
      try { $listView = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $listViewCondition) } catch { $listView = $null }
      if ($null -ne $listView) {
        try {
          $listView.SetFocus()
          [System.Windows.Forms.SendKeys]::SendWait($leaf)
        } catch {
          # The list view can be replaced during a refresh; retry next poll.
        }
      }
    }
    if ($null -eq $candidate) { Start-Sleep -Milliseconds 100 }
  }
  if ($null -eq $candidate) {
    $fileNameEdit = Find-FileNameEdit $dialog
    if ($null -ne $fileNameEdit) {
      Set-EditText $fileNameEdit $target
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      if (Wait-DialogClosed 5) { Write-Output 'NATIVE_DIALOG_OK'; exit 0 }
    }
    $visibleNames = for ($index = 0; $index -lt $items.Count; $index++) {
      $item = $items.Item($index)
      try { if ($item.Current.Name) { $item.Current.Name } } catch {}
    }
    throw "原生文件对话框未找到目标项：$target；当前列表：$($visibleNames -join ', ')"
  }
  $candidate.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
}

$buttonNames = if ($Mode -eq 'folder') { @('选择文件夹', '选择此文件夹', 'Select Folder', 'Select this folder', '选择', '确定', 'OK') } else { @('打开', 'Open', '选择', '确定', 'OK') }
$button = Find-ButtonByName $dialog $buttonNames
if ($null -eq $button) {
  $buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonType)
  $available = for ($index = 0; $index -lt $buttons.Count; $index++) {
    $item = $buttons.Item($index)
    "$($item.Current.Name) [$($item.Current.AutomationId)]"
  }
  $allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $windowSummary = for ($index = 0; $index -lt $allWindows.Count; $index++) {
    $window = $allWindows.Item($index)
    try { "$($window.Current.Name) {$($window.Current.ClassName)}" } catch {}
  }
  throw "原生文件对话框缺少提交按钮：$Title；当前按钮：$($available -join ', ')；桌面窗口：$($windowSummary -join ' | ')"
}
$dialog.SetFocus()
$invoked = $false
try {
  $invokePattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invokePattern.Invoke()
  $invoked = $true
} catch {
  $invokeError = $_.Exception.Message
}
if (-not $invoked) {
  try {
    $selectionPattern = $button.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $selectionPattern.Select()
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    $invoked = $true
  } catch {
    $selectionError = $_.Exception.Message
  }
}
if (-not $invoked) {
  try {
    $button.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    $invoked = $true
  } catch {
    $focusError = $_.Exception.Message
  }
}
if (-not $invoked) {
  throw "原生文件对话框提交按钮无法激活：$Title；Invoke=$invokeError；Selection=$selectionError；Focus=$focusError"
}

Write-Output 'NATIVE_DIALOG_OK'
