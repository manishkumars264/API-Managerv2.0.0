from pathlib import Path
file = Path(__file__).resolve().parents[1] / 'tests/e2e/workspace.spec.ts'
text = file.read_text(encoding='utf-8')
start = text.index("test('previews generated authorization headers")
end = text.index("test('keeps newest Console", start)
block = text[start:end]
old = "const editorTab = (name: string) => page.locator('.request-editor .editor-tabs').getByRole('button', { name: new RegExp(`^${name}`) }).click();"
new = """const editorTab = async (name: string) => {
      await page.locator('.request-editor .editor-tabs').getByRole('button', { name: new RegExp(`^${name}`) }).click();
      if (name === 'Headers') {
        await expect(page.locator('.generated-headers')).not.toHaveAttribute('open', '');
        await page.locator('.generated-headers > summary').click();
        await expect(page.getByRole('table', { name: 'Auto-generated request headers', exact: true })).toBeVisible();
      }
    };"""
assert block.count(old) == 1
block = block.replace(old, new)
old = "await expect(page.getByRole('table', { name: 'Auto-generated request headers', exact: true })).toContainText('API-Manager/2.0.0');"
new = "await expect(page.locator('.generated-headers')).not.toHaveAttribute('open', '');\n    await page.locator('.generated-headers > summary').click();\n    " + old
assert block.count(old) == 1
text = text[:start] + block.replace(old, new) + text[end:]
assert text.count("'rgb(205, 210, 216)'") == 1
text = text.replace("'rgb(205, 210, 216)'", "'rgb(170, 170, 170)'")
file.write_text(text, encoding='utf-8', newline='\n')
