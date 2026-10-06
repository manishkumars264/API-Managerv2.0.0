from pathlib import Path
root = Path(__file__).resolve().parents[1]
text = (root / '.local-test/portable-icon-fix-smoke-20261004.cjs').read_text(encoding='utf-8')
text = text.replace('portable-icon-fix', 'portable-corrections').replace('20261004', '20261006')
text = text.replace("path.resolve('release/API Manager 2.0.0.exe')", "path.resolve('release/corrections-final-build-20261006/API Manager 2.0.0.exe')")
text = text.replace('release/icon-fix-build/', 'release/corrections-final-build-20261006/')
text = text.replace("!== '#bec2c8'", "!== '#9e9e9e'")
needle = "await page.getByRole('button', { name: 'Edit active environment', exact: true }).click();"
assert text.count(needle) == 1
text = text.replace(needle, "await expect(page.getByRole('combobox', { name: 'Active environment', exact: true }).locator('option:checked')).toHaveText('Global');\n    " + needle)
needle = "await expect(page.getByRole('table', { name: 'Auto-generated request headers', exact: true })).toContainText('Bearer portable-verified-token');"
assert text.count(needle) == 1
text = text.replace(needle, """await expect(page.locator('.generated-headers')).not.toHaveAttribute('open', '');
    await page.locator('.generated-headers > summary').click();
    """ + needle + """
    await page.locator('.request-editor .editor-tabs').getByRole('button', { name: 'Body', exact: true }).click();
    await page.locator('.request-editor .editor-tabs').getByRole('button', { name: 'Headers', exact: true }).click();
    await expect(page.locator('.generated-headers')).not.toHaveAttribute('open', '');
    await page.locator('.generated-headers > summary').click();
    """ + needle)
needle = "await expect(help).toContainText('v2.0.0');"
assert text.count(needle) == 1
text = text.replace(needle, needle + "\n    await expect(help.locator('.api-help-meta')).toContainText('4 October 2026');")
text = text.replace('automaticVariableRows:true,', 'globalOption:true,hiddenHeadersCollapse:true,releaseDate:"2026-10-04",automaticVariableRows:true,')
dest = root / '.local-test/portable-corrections-smoke-20261006.cjs'
dest.write_text(text, encoding='utf-8', newline='\n')
print('Prepared actual portable smoke checks for the final corrected build.')
