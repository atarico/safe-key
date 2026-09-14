//! Plain-text CSV interchange with other password managers.
//!
//! This module never touches the vault: it turns records into CSV text and
//! back. Everything it handles is already decrypted, so it is deliberately
//! small and covered in depth — a parser that silently mangles a password is
//! worse than one that refuses the file.

use crate::error::SafekeyError;

/// One exported credential, in the shape other managers understand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsvRecord {
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
    pub note: Option<String>,
}

/// The header Safekey writes. Chrome and Bitwarden both import this shape.
const HEADER: [&str; 5] = ["name", "url", "username", "password", "note"];

/// Column spellings seen in the wild, mapped to the field they fill.
const ALIASES: [(&str, &[&str]); 5] = [
    ("name", &["name", "title"]),
    ("url", &["url", "uri", "login_uri", "website"]),
    ("username", &["username", "login_username", "user", "email"]),
    ("password", &["password", "login_password", "pass"]),
    ("note", &["note", "notes", "comment"]),
];

/// Renders records as RFC 4180 CSV. Quoting is the crate's job precisely
/// because passwords are allowed to contain commas, quotes and newlines.
pub fn to_csv(records: &[CsvRecord]) -> String {
    let mut writer = ::csv::Writer::from_writer(Vec::new());

    writer.write_record(HEADER).expect("writing to a Vec cannot fail");
    for record in records {
        writer
            .write_record([
                &record.name,
                &record.url,
                &record.username,
                &record.password,
                record.note.as_deref().unwrap_or(""),
            ])
            .expect("writing to a Vec cannot fail");
    }

    String::from_utf8(writer.into_inner().expect("flushing a Vec cannot fail"))
        .expect("every field was already valid UTF-8")
}

/// Parses CSV exported by Safekey or another manager.
///
/// Unknown columns are ignored and rows without a password are skipped: a
/// credential with no secret is not one, and importing it as blank would
/// quietly overwrite nothing with nothing.
pub fn from_csv(input: &str) -> Result<Vec<CsvRecord>, SafekeyError> {
    // An unterminated quote turns the rest of the file into one runaway
    // field. Opened in the last column it still yields a header-length
    // record, so the reader's length check never sees it and every later
    // credential vanishes into that value. A well-formed CSV always carries
    // an even number of quote characters — the doubled ones inside a quoted
    // field included — so an odd count is proof of the hazard.
    if input.matches('"').count() % 2 != 0 {
        return Err(SafekeyError::InvalidInput(
            "This file has an unterminated quote, so everything after it would be read as a single value. Fix the export and try again."
                .into(),
        ));
    }

    // Strict on purpose: a row that does not match the header means the file
    // is malformed. Refusing beats losing.
    let mut reader = ::csv::ReaderBuilder::new()
        .flexible(false)
        .from_reader(input.as_bytes());

    let headers = reader
        .headers()
        .map_err(|e| SafekeyError::InvalidInput(format!("Could not read the CSV header: {e}")))?
        .clone();

    let column_of = |field: &str| -> Option<usize> {
        let accepted = ALIASES
            .iter()
            .find(|(name, _)| *name == field)
            .map(|(_, spellings)| *spellings)
            .unwrap_or(&[]);

        // Walk the aliases, not the headers: the alias list is a preference
        // order, so a file carrying both `username` and `email` yields the
        // username rather than whichever column happens to come first.
        accepted.iter().find_map(|alias| {
            headers
                .iter()
                .position(|header| header.trim().to_lowercase() == *alias)
        })
    };

    let password_at = column_of("password").ok_or_else(|| {
        SafekeyError::InvalidInput(
            "This file has no password column, so it is not a credential export.".into(),
        )
    })?;
    let name_at = column_of("name");
    let url_at = column_of("url");
    let username_at = column_of("username");
    let note_at = column_of("note");

    let at = |row: &::csv::StringRecord, index: Option<usize>| {
        index
            .and_then(|i| row.get(i))
            .unwrap_or("")
            .trim()
            .to_string()
    };

    let mut records = Vec::new();
    for row in reader.records() {
        let row =
            row.map_err(|e| SafekeyError::InvalidInput(format!("Malformed CSV row: {e}")))?;

        let password = row.get(password_at).unwrap_or("").to_string();
        if password.is_empty() {
            continue;
        }

        let note = at(&row, note_at);
        records.push(CsvRecord {
            name: at(&row, name_at),
            url: at(&row, url_at),
            username: at(&row, username_at),
            password,
            note: if note.is_empty() { None } else { Some(note) },
        });
    }

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_record() -> CsvRecord {
        CsvRecord {
            name: "github.com".into(),
            url: "github.com".into(),
            username: "ada".into(),
            password: "s3cret".into(),
            note: Some("work account".into()),
        }
    }

    #[test]
    fn writes_a_header_other_managers_recognise() {
        let csv = to_csv(&[a_record()]);
        let header = csv.lines().next().unwrap();

        assert_eq!(header, "name,url,username,password,note");
    }

    #[test]
    fn a_record_survives_a_round_trip() {
        let records = vec![a_record()];

        let parsed = from_csv(&to_csv(&records)).unwrap();

        assert_eq!(parsed, records);
    }

    #[test]
    fn passwords_containing_csv_syntax_survive_a_round_trip() {
        // The characters that break a hand-rolled parser are exactly the ones
        // a password generator is allowed to produce.
        let nasty = vec![
            r#"comma,separated"#,
            r#"quote"inside"#,
            "line\nbreak",
            r#""fully quoted""#,
            r#"tab	and,"everything""#,
        ];

        for password in nasty {
            let record = CsvRecord {
                password: password.into(),
                ..a_record()
            };

            let parsed = from_csv(&to_csv(&[record.clone()])).unwrap();

            assert_eq!(parsed, vec![record], "mangled password: {password:?}");
        }
    }

    #[test]
    fn an_absent_note_round_trips_as_absent() {
        let record = CsvRecord {
            note: None,
            ..a_record()
        };

        let parsed = from_csv(&to_csv(&[record.clone()])).unwrap();

        assert_eq!(parsed[0].note, None);
    }

    #[test]
    fn reads_the_column_names_other_managers_emit() {
        // Bitwarden and Chrome disagree on spelling; both must import.
        let bitwarden = "name,login_uri,login_username,login_password,notes\n\
                         GitHub,github.com,ada,s3cret,work account\n";

        let parsed = from_csv(bitwarden).unwrap();

        assert_eq!(parsed[0].username, "ada");
        assert_eq!(parsed[0].password, "s3cret");
        assert_eq!(parsed[0].url, "github.com");
        assert_eq!(parsed[0].note.as_deref(), Some("work account"));
    }

    #[test]
    fn prefers_the_username_column_over_an_email_one() {
        // Both spellings are accepted, but the alias list ranks them. A file
        // carrying both must not win by column order.
        let csv = "email,username,password\nada@example.com,ada,s3cret\n";

        let parsed = from_csv(csv).unwrap();

        assert_eq!(parsed[0].username, "ada");
    }

    #[test]
    fn keeps_whitespace_that_is_part_of_a_password() {
        // Every other field is trimmed. A password is not: leading and
        // trailing spaces can be the secret itself, and silently dropping
        // them locks the user out of their own account.
        let record = CsvRecord {
            password: "  padded  ".into(),
            ..a_record()
        };

        let parsed = from_csv(&to_csv(&[record])).unwrap();

        assert_eq!(parsed[0].password, "  padded  ");
    }

    #[test]
    fn reads_a_file_that_starts_with_a_byte_order_mark() {
        // Exports produced on Windows routinely carry a UTF-8 BOM. Left in
        // place it welds itself to the first header name, so the column stops
        // matching and the file imports wrong or not at all.
        let with_bom = "\u{feff}name,url,username,password,note\nGitHub,github.com,ada,s3cret,\n";

        let parsed = from_csv(with_bom).unwrap();

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "GitHub");
        assert_eq!(parsed[0].password, "s3cret");
    }

    #[test]
    fn refuses_an_unterminated_quote_in_the_final_column() {
        // The reader's equal-length check cannot see this one: the runaway
        // field is the last column, so the record still has exactly
        // header-length fields while swallowing every later credential.
        let broken = "name,url,username,password,note\nGitHub,github.com,ada,s3cret,\"unclosed\nOther,other.com,bob,hunter2,\n";

        let err = from_csv(broken).unwrap_err();

        assert!(
            matches!(err, SafekeyError::InvalidInput(_)),
            "expected InvalidInput, got {err:?}"
        );
    }

    #[test]
    fn refuses_a_file_whose_rows_do_not_match_its_header() {
        // An unterminated quote makes the rest of the file one giant field,
        // so every later credential disappears into it. Refusing the file is
        // the only honest outcome: importing one corrupt row in place of five
        // hundred real ones is silent data loss.
        let broken = "name,url,username,password,note\nGitHub,github.com,ada,\"unclosed,\nOther,other.com,bob,hunter2,\n";

        let err = from_csv(broken).unwrap_err();

        assert!(
            matches!(err, SafekeyError::InvalidInput(_)),
            "expected InvalidInput, got {err:?}"
        );
    }

    #[test]
    fn ignores_columns_it_does_not_understand() {
        let extra = "name,url,username,password,note,folder,favorite\n\
                     GitHub,github.com,ada,s3cret,,Personal,1\n";

        let parsed = from_csv(extra).unwrap();

        assert_eq!(parsed[0].username, "ada");
        assert_eq!(parsed[0].password, "s3cret");
    }

    #[test]
    fn refuses_a_file_with_no_password_column() {
        let headerless = "name,url,username\nGitHub,github.com,ada\n";

        let err = from_csv(headerless).unwrap_err();

        assert!(
            matches!(err, SafekeyError::InvalidInput(_)),
            "expected InvalidInput, got {err:?}"
        );
    }

    #[test]
    fn reads_an_export_with_no_rows_as_no_records() {
        let parsed = from_csv("name,url,username,password,note\n").unwrap();

        assert!(parsed.is_empty());
    }

    #[test]
    fn skips_a_row_with_no_password_rather_than_importing_a_blank_one() {
        let csv = "name,url,username,password,note\n\
                   GitHub,github.com,ada,s3cret,\n\
                   Empty,empty.com,bob,,\n";

        let parsed = from_csv(csv).unwrap();

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].username, "ada");
    }
}
