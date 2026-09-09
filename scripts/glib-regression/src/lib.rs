#[cfg(test)]
mod tests {
    use glib::prelude::*;

    #[test]
    fn variant_string_iterator_uses_valid_output_pointers() {
        let value = ["零", "one", "two", "三", "four"].to_variant();
        assert_eq!(
            value.array_iter_str().unwrap().collect::<Vec<_>>(),
            ["零", "one", "two", "三", "four"]
        );
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.next(), Some("零"));
        assert_eq!(iter.next_back(), Some("four"));
        assert_eq!(iter.nth(1), Some("two"));
        assert_eq!(iter.nth_back(0), Some("三"));
        assert_eq!(iter.next(), None);
        assert_eq!(value.array_iter_str().unwrap().last(), Some("four"));
    }
}
