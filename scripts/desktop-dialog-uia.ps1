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

function Find-Edit([System.Windows.Automation.AutomationElement]$parent) {
  $idCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    '1152'
  )
  $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCondition)
  if ($null -ne $element) { return $element }
  $editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  return $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
}

function Find-FileNameEdit([System.Windows.Automation.AutomationElement]$parent) {
  foreach ($id in @('1148', 'FileNameControlHost')) {
    $idCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      $id
    )
    $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCondition)
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
  return $null
}

function Find-AddressEdit([System.Windows.Automation.AutomationElement]$parent) {
  $idCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    '41477'
  )
  $element = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCondition)
  if ($null -ne $element) { return $element }
  $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    '地址'
  )
  $editType = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $combined = New-Object System.Windows.Automation.AndCondition($nameCondition, $editType)
  return $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $combined)
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
  $address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($directory.FullName)
  $address.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 500
  return $directory.Name
}

$target = [IO.Path]::GetFullPath($Path)
$leaf = [IO.Path]::GetFileName($target.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
if ($Mode -eq 'folder') {
  if (-not [IO.Directory]::Exists($target)) { throw "目标文件夹不存在：$target" }
  $folderEdit = Find-Edit $dialog
  if ($null -eq $folderEdit) { throw "原生文件夹选择器缺少文件夹输入框：$Title" }
  $folderEdit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($target)
  $folderEdit.SetFocus()
} else {
  $parentDirectory = [IO.DirectoryInfo]::new($target).Parent
  if ($null -eq $parentDirectory) { throw "无法确定原生选择器目标父目录：$target" }
  Navigate-To $dialog $parentDirectory.FullName | Out-Null
}
$buttonType = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
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
  $listCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ListItem
  )
  $listDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $listDeadline -and $null -eq $candidate) {
    $items = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $listCondition)
    for ($index = 0; $index -lt $items.Count -and $null -eq $candidate; $index++) {
      if ($items.Item($index).Current.Name -eq $leaf) { $candidate = $items.Item($index) }
    }
    if ($null -eq $candidate) {
      $listViewCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        'listview'
      )
      $listView = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $listViewCondition)
      if ($null -ne $listView) {
        $listView.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait($leaf)
      }
    }
    if ($null -eq $candidate) { Start-Sleep -Milliseconds 100 }
  }
  if ($null -eq $candidate) {
    $fileNameEdit = Find-FileNameEdit $dialog
    if ($null -ne $fileNameEdit) {
      $fileNameEdit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($target)
      $fileNameEdit.SetFocus()
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      Start-Sleep -Milliseconds 500
      if ($null -eq (Resolve-Dialog)) { Write-Output 'NATIVE_DIALOG_OK'; exit 0 }
    }
    $visibleNames = for ($index = 0; $index -lt $items.Count; $index++) {
      $item = $items.Item($index)
      if ($item.Current.Name) { $item.Current.Name }
    }
    throw "原生文件对话框未找到目标项：$target；当前列表：$($visibleNames -join ', ')"
  }
  $candidate.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
}

$buttonNames = if ($Mode -eq 'folder') { @('选择文件夹', '选择此文件夹', 'Select Folder', 'Select this folder', '选择', '确定', 'OK') } else { @('打开', 'Open', '选择', '确定', 'OK') }
$button = Find-DescendantByName $dialog $buttonNames
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
$invokePattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invokePattern.Invoke()

Write-Output 'NATIVE_DIALOG_OK'
