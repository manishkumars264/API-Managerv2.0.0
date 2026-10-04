from pathlib import Path
p = Path('tests/e2e/workspace.spec.ts')
s = p.read_text()
start = s.index("test('adds popup environment variables with plus")
end = s.index("test('keeps newest Console", start)
s = s[:start] + '''test('automatically adds checked popup variables, deletes rows, and saves with Ctrl+S', async () => {
  test.setTimeout(150000);
  const dataDir = await directory(), workspace = initialWorkspace();
  workspace.environments = [{ id: 'new-variables', name: 'Development', variables: [] }]; workspace.activeEnvironmentId = 'new-variables';
  workspace.tabs[0].request.url = `${baseUrl}/echo?new={{new_value}}`;
  await fs.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
  let { app, page } = await launch(dataDir);
  try {
    const open = () => page.getByRole('button', { name: 'Edit active environment', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Environment values', exact: true });
    await open(); await dialog.getByRole('button', { name: 'Close dialog', exact: true }).press('Control+s');
    await expect(dialog).toHaveCount(0); await open();
    await dialog.getByRole('textbox', { name: 'Add variable name', exact: true }).pressSequentially('new_value');
    await expect(dialog.getByRole('textbox', { name: 'Variable name 1', exact: true })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Disable new_value', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('textbox', { name: 'Add variable name', exact: true })).toHaveCount(1);
    await dialog.getByRole('textbox', { name: 'Value for new_value', exact: true }).fill('saved-from-shortcut');
    await dialog.getByRole('textbox', { name: 'Value for new_value', exact: true }).press('Control+s');
    await expect(dialog).toHaveCount(0); await expect(page.getByRole('dialog', { name: 'Save request' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Send', exact: true }).click(); await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await expect.poll(async () => { try { return JSON.parse((await readWorkspace(dataDir)).history[0].response!.body).path; } catch { return ''; } }).toBe('/echo?new=saved-from-shortcut');
    await open(); await dialog.getByRole('textbox', { name: 'Add variable value', exact: true }).pressSequentially('value-first');
    await expect(dialog.getByRole('textbox', { name: 'Value for variable 2', exact: true })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Disable variable 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Enter a name');
    await expect(dialog.getByRole('textbox', { name: 'Variable name 2', exact: true })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Variable name 2', exact: true }).fill('second');
    await dialog.getByRole('button', { name: 'Disable second', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Value for second', exact: true }).fill('kept-disabled');
    await expect(dialog.getByRole('button', { name: 'Enable second', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await readWorkspace(dataDir)).environments[0].variables.map(row => [row.key, row.value, row.enabled])).toEqual([['new_value', 'saved-from-shortcut', true], ['second', 'kept-disabled', false]]);
    await open(); await dialog.getByRole('button', { name: 'Delete variable new_value', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Value for new_value', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await open();
    await expect(dialog.getByRole('textbox', { name: 'Value for new_value', exact: true })).toHaveValue('saved-from-shortcut');
    await dialog.getByRole('button', { name: 'Delete variable second', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Add variable name', exact: true }).fill('discarded');
    await dialog.getByRole('button', { name: 'Delete variable discarded', exact: true }).click();
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).press('Control+s');
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await readWorkspace(dataDir)).environments[0].variables.length).toBe(1);
    await closeNormally(app); ({ app, page } = await launch(dataDir)); await open();
    await expect(dialog.getByRole('textbox', { name: 'Value for new_value', exact: true })).toHaveValue('saved-from-shortcut');
    await expect(dialog.getByRole('button', { name: 'Delete variable second', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Delete variable new_value', exact: true }).click();
    await expect(dialog.locator('.quick-variable-delete')).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'Add variable name', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await readWorkspace(dataDir)).environments[0].variables).toEqual([]);
    await page.getByRole('combobox', { name: 'Active environment', exact: true }).selectOption(''); await open();
    await expect(dialog).toContainText('Globals');
    await dialog.getByRole('textbox', { name: 'Add variable name', exact: true }).fill('global-added');
    await dialog.getByRole('textbox', { name: 'Value for global-added', exact: true }).fill('global-value');
    await dialog.getByRole('textbox', { name: 'Value for global-added', exact: true }).press('Control+s');
    await expect.poll(async () => (await readWorkspace(dataDir)).globals.map(row => [row.key, row.value, row.enabled])).toEqual([['global-added', 'global-value', true]]);
    await open(); await dialog.getByRole('button', { name: 'Delete variable global-added', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await readWorkspace(dataDir)).globals).toEqual([]);
    await page.getByRole('button', { name: 'Environments', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete environment', exact: true })).toHaveText('Delete');
  } finally { await cleanup(app); }
});

''' + s[end:]
s = s.replace("'rgb(233, 235, 238)'", "'rgb(205, 210, 216)'")
needle = "    await expect(left).toBeVisible(); await expect(right).toBeVisible();"
addition = """
    await expect(left).toBeDisabled(); await expect(right).toBeEnabled();
    await expect(right).toHaveCSS('color', 'rgb(75, 148, 212)');
    expect(await left.evaluate(node => getComputedStyle(node).color)).not.toBe(await right.evaluate(node => getComputedStyle(node).color));
    await expect(left).toHaveCSS('opacity', '1');
    const divider = page.locator('.request-tabs-strip');
    await expect(divider).toHaveCSS('border-left-width', '1px');
    await expect(divider).toHaveCSS('padding-left', '14px');
    expect(await divider.evaluate(node => getComputedStyle(node).borderLeftColor)).toBe(await page.locator('.environment-selector').evaluate(node => getComputedStyle(node).borderLeftColor));
"""
assert needle in s
s = s.replace(needle, needle + addition, 1)
needle = "    await expect(namedTab(13)).toHaveAttribute('aria-selected', 'true');\n    await selectedTabIsVisible();"
assert needle in s
s = s.replace(needle, needle + "\n    await expect(right).toBeDisabled(); await expect(left).toBeEnabled();\n    expect(await right.evaluate(node => getComputedStyle(node).color)).not.toBe(await left.evaluate(node => getComputedStyle(node).color));", 1)
p.write_text(s)
